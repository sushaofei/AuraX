#!/usr/bin/env bash
# Restore DEV_WEB :80 homepage (CHAINTOWER frontend). Does not touch AuraX on :1420.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_ENV="${ROOT}/.host.env"
if [[ ! -f "${HOST_ENV}" && -f "${ROOT}/../AuraClaw/.host.env" ]]; then
  HOST_ENV="${ROOT}/../AuraClaw/.host.env"
fi

HOMEPAGE_SOURCE="${DEV_WEB_HOMEPAGE_SOURCE:-/data/nginx/html.bak.frontend-20260817-221700}"

usage() {
  cat <<EOF
Usage: ./scripts/restore_dev_web_homepage.sh [options]

Restore the site homepage on DEV_WEB port :80 from a known-good backup.
AuraX stays on :1420 (aurax-web container).

Options:
  --source PATH   backup directory (default: ${HOMEPAGE_SOURCE})
  -h, --help      show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      HOMEPAGE_SOURCE="$2"
      shift 2
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
done

if [[ ! -f "${HOST_ENV}" ]]; then
  echo "missing .host.env" >&2
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
else
  SSH_CMD=(sshpass -e ssh -o StrictHostKeyChecking=no)
fi

echo "==> restore homepage on ${REMOTE} from ${HOMEPAGE_SOURCE}"

"${SSH_CMD[@]}" "${REMOTE}" "bash -s" <<REMOTE
set -euo pipefail
SOURCE="${HOMEPAGE_SOURCE}"
if [[ ! -f "\${SOURCE}/index.html" ]]; then
  echo "backup missing index.html: \${SOURCE}" >&2
  exit 1
fi
if grep -q '<title>AuraX</title>' "\${SOURCE}/index.html" 2>/dev/null; then
  echo "refusing to restore AuraX as homepage from \${SOURCE}" >&2
  exit 1
fi
STAMP=\$(date +%Y%m%d_%H%M%S)
sudo mkdir -p /data/nginx/backups
if [[ -f /data/nginx/html/index.html ]]; then
  sudo mkdir -p "/data/nginx/backups/\${STAMP}/html"
  sudo cp -a /data/nginx/html/. "/data/nginx/backups/\${STAMP}/html/"
  echo "\${STAMP}" | sudo tee "/data/nginx/backups/\${STAMP}/timestamp.txt" >/dev/null
fi
sudo rm -rf /data/nginx/html/*
sudo cp -a "\${SOURCE}/." /data/nginx/html/
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
REMOTE

NO_PROXY="${HOST},127.0.0.1,localhost${NO_PROXY:+,${NO_PROXY}}" \
  no_proxy="${HOST},127.0.0.1,localhost${no_proxy:+,${no_proxy}}" \
  curl --fail --silent --show-error "http://${HOST}/" | head -3

if NO_PROXY="${HOST},127.0.0.1,localhost${NO_PROXY:+,${NO_PROXY}}" \
  no_proxy="${HOST},127.0.0.1,localhost${no_proxy:+,${no_proxy}}" \
  curl --fail --silent "http://${HOST}/" | grep -q '<title>AuraX</title>'; then
  echo "homepage still shows AuraX — restore failed" >&2
  exit 1
fi

echo "==> homepage restored on http://${HOST}/"
