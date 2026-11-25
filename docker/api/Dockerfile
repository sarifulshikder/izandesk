# syntax=docker/dockerfile:1.7
# Multi-arch API image: linux/amd64, linux/arm64, linux/arm/v7.
# Built natively for each target platform (bcrypt and other native modules are compiled per arch).
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV COREPACK_DEFAULT_TO_LATEST=0
# pnpm 10+ ships only native binaries and has none for linux/arm; 9.x is pure JS and reads lockfile v9.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN apk add --no-cache python3 make g++
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @izandesk/shared-types build \
 && pnpm --filter api build \
 && pnpm --filter api deploy --prod /out/api

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# CLI tools used by the system/OLT/wireguard/subscriber integrations (same as docker-compose).
RUN apk add --no-cache \
      tini bash \
      net-snmp-tools iputils bind-tools wireguard-tools postgresql-client
ENV NODE_ENV=production
COPY --from=build /out/api ./
COPY apps/api/migrations/ ./migrations/
# Bundled payment/OLT/SMS plugins live at the repo root, outside the api
# package, so `pnpm deploy` does not include them. Copy them explicitly.
COPY plugins/ /plugins/
ENV PLUGINS_DIR=/plugins \
    MIGRATE_ON_START=true
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
