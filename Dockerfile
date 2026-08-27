# AuraX web (static SPA + nginx /v1 uplink). Tauri desktop builds are separate.
FROM node:22-bookworm-slim AS build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/
COPY packages/claw-sdk/package.json packages/claw-sdk/tsconfig.json packages/claw-sdk/

RUN pnpm install --frozen-lockfile

COPY apps/desktop apps/desktop
COPY packages/claw-sdk packages/claw-sdk
COPY eslint.config.mjs ./

ARG VITE_AURAX_UPLINK=same-origin
ENV VITE_AURAX_UPLINK=${VITE_AURAX_UPLINK}

RUN pnpm build

FROM nginx:1.27-alpine

COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/desktop/dist /usr/share/nginx/html

EXPOSE 80
