#!/usr/bin/env bash
# DEV_WEB deploy: local build → rsync → dedicated nginx container on :1420.
# Port :80 on 10.244.16.130 stays the site homepage; AuraX does not replace it.
#
# Usage (from AuraX repo root):
#   ./scripts/dev_web_deploy.sh
#   ./scripts/dev_web_deploy.sh --skip-build
#
# Restore :80 homepage (separate from AuraX deploy):
#   ./scripts/restore_dev_web_homepage.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_ENV="${ROOT}/.host.env"
if [[ ! -f "${HOST_ENV}" && -f "${ROOT}/../AuraClaw/.host.env" ]]; then
  HOST_ENV="${ROOT}/../AuraClaw/.host.env"
fi

AURAX_PORT="${AURAX_HTTP_PORT:-1420}"
AURAX_CONTAINER="${AURAX_CONTAINER_NAME:-aurax-web}"
DO_BUILD=1
DO_SYNC=1
DO_UP=1
DO_HEALTH=1

usage() {
  cat <<'EOF'
Usage: ./scripts/dev_web_deploy.sh [options]

  (default)     pnpm build → rsync → aurax-web container on :1420 only
  --skip-build  skip local pnpm build (reuse apps/desktop/dist)
  --skip-sync   skip rsync
  --skip-up     skip container recreate
  --skip-health skip curl health check
  -h, --help    show this help

AuraX never writes /data/nginx/html (port :80 homepage).
To restore the homepage: ./scripts/restore_dev_web_homepage.sh

Reads DEV_WEB_* from .host.env (AuraX repo or ../AuraClaw/.host.env).
Uses sshpass when DEV_WEB_HOST_PWD is set or SSHPASS is exported.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) DO_BUILD=0 ;;
    --skip-sync) DO_SYNC=0 ;;
    --skip-up) DO_UP=0 ;;
    --skip-health) DO_HEALTH=0 ;;
    --restore-homepage)
      echo "use ./scripts/restore_dev_web_homepage.sh instead of --restore-homepage" >&2
      exit 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "${AURAX_PORT}" == "80" || "${AURAX_PORT}" == "443" ]]; then
  echo "refusing to bind AuraX to port ${AURAX_PORT} — homepage nginx uses :80" >&2
  exit 1
fi

if [[ "${AURAX_CONTAINER}" == "nginx" ]]; then
  echo 'refusing container name "nginx" — that is the homepage reverse proxy' >&2
  exit 1
fi

if [[ ! -f "${HOST_ENV}" ]]; then
  echo "missing .host.env (copy DEV_WEB_* from AuraClaw/.host.env)" >&2
  exit 1
fi

host_var() {
  local key="$1"
  grep -E "^${key}=" "${HOST_ENV}" | head -n1 | cut -d= -f2- || true
}

HOST="$(host_var DEV_WEB_HOST_ADDR)"
USER_NAME="$(host_var DEV_WEB_HOST_USER)"
USER_NAME="${USER_NAME:-jcroot}"
REMOTE="${USER_NAME}@${HOST}"

if [[ -z "${HOST}" ]]; then
  echo "DEV_WEB_HOST_ADDR missing in ${HOST_ENV}" >&2
  exit 1
fi

if [[ -z "${SSHPASS:-}" ]]; then
  SSHPASS="$(host_var DEV_WEB_HOST_PWD)"
  export SSHPASS
fi

if ! command -v sshpass >/dev/null 2>&1 || [[ -z "${SSHPASS}" ]]; then
  SSH_CMD=(ssh -o BatchMode=yes -o StrictHostKeyChecking=no)
  RSYNC_SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"
else
  SSH_CMD=(sshpass -e ssh -o StrictHostKeyChecking=no)
  RSYNC_SSH="sshpass -e ssh -o StrictHostKeyChecking=no"
fi

remote() {
  "${SSH_CMD[@]}" "${REMOTE}" "$@"
}

echo "==> target ${REMOTE}"
echo "==> aurax  http://${HOST}:${AURAX_PORT}/ (homepage :80 is not modified)"

if [[ "${DO_BUILD}" -eq 1 ]]; then
  echo "==> pnpm build"
  (cd "${ROOT}" && VITE_AURAX_UPLINK=same-origin pnpm build)
else
  echo "==> skip build"
fi

DIST="${ROOT}/apps/desktop/dist"
if [[ ! -f "${DIST}/index.html" ]]; then
  echo "missing ${DIST}/index.html — run build first" >&2
  exit 1
fi

if [[ "${DO_SYNC}" -eq 1 ]]; then
  echo "==> rsync dist + nginx config (aurax paths only)"
  rsync -az --delete -e "${RSYNC_SSH}" "${DIST}/" "${REMOTE}:/tmp/aurax-dist/"
  rsync -az -e "${RSYNC_SSH}" "${ROOT}/deploy/host-nginx/aurax.conf" "${REMOTE}:/tmp/aurax-nginx.conf"
else
  echo "==> skip rsync"
fi

if [[ "${DO_UP}" -eq 1 ]]; then
  echo "==> deploy aurax-web on :${AURAX_PORT}"
  remote "bash -s" <<REMOTE
set -euo pipefail
HOMEPAGE_HASH_BEFORE=""
if [[ -f /data/nginx/html/index.html ]]; then
  HOMEPAGE_HASH_BEFORE=\$(sudo md5sum /data/nginx/html/index.html | awk '{print \$1}')
fi
sudo mkdir -p /data/aurax/html
sudo rm -rf /data/aurax/html/*
sudo cp -a /tmp/aurax-dist/* /data/aurax/html/
sudo cp /tmp/aurax-nginx.conf /data/aurax/nginx.conf
if [[ -n "\${HOMEPAGE_HASH_BEFORE}" && -f /data/nginx/html/index.html ]]; then
  HOMEPAGE_HASH_AFTER=\$(sudo md5sum /data/nginx/html/index.html | awk '{print \$1}')
  if [[ "\${HOMEPAGE_HASH_BEFORE}" != "\${HOMEPAGE_HASH_AFTER}" ]]; then
    echo "ERROR: /data/nginx/html changed during AuraX deploy — aborting" >&2
    exit 1
  fi
fi
if sudo docker ps --format '{{.Names}}' | grep -qx 'nginx'; then
  :
else
  echo "warning: homepage nginx container not running" >&2
fi
sudo docker rm -f ${AURAX_CONTAINER} 2>/dev/null || true
sudo docker run -d --name ${AURAX_CONTAINER} \\
  --restart unless-stopped \\
  -p ${AURAX_PORT}:80 \\
  -v /data/aurax/html:/usr/share/nginx/html:ro \\
  -v /data/aurax/nginx.conf:/etc/nginx/conf.d/default.conf:ro \\
  nginx:latest
REMOTE
else
  echo "==> skip up"
fi

if [[ "${DO_HEALTH}" -eq 1 && "${DO_UP}" -eq 1 ]]; then
  echo "==> health"
  export NO_PROXY="${HOST},10.244.16.131,127.0.0.1,localhost${NO_PROXY:+,${NO_PROXY}}"
  export no_proxy="${HOST},10.244.16.131,127.0.0.1,localhost${no_proxy:+,${no_proxy}}"
  if curl --fail --silent --show-error "http://${HOST}:${AURAX_PORT}/" >/dev/null; then
    echo "ready: http://${HOST}:${AURAX_PORT}/"
    if curl --fail --silent --show-error "http://${HOST}:${AURAX_PORT}/health/ready" >/dev/null; then
      echo "uplink: http://${HOST}:${AURAX_PORT}/health/ready → AuraClaw"
    else
      echo "warning: uplink health failed (check NO_PROXY if using a local HTTP proxy)" >&2
    fi
  else
    echo "health check failed: http://${HOST}:${AURAX_PORT}/" >&2
    exit 1
  fi
  if curl --fail --silent "http://${HOST}/" | grep -q '<title>AuraX</title>'; then
    echo "ERROR: homepage :80 is serving AuraX — run ./scripts/restore_dev_web_homepage.sh" >&2
    exit 1
  fi
  echo "homepage: http://${HOST}/ (unchanged)"
fi

echo "==> done"
