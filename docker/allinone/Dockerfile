# syntax=docker/dockerfile:1.7
# Single-container RouterOS image: API + web + Postgres/PostGIS + Redis.
# One veth/IP, one published port. Built for linux/arm/v7.
ARG NODE_IMAGE=node:22-alpine
ARG INTERNAL_API_URL=http://127.0.0.1:4000

# Next.js has no arm/v7 SWC binary, so the web build always runs on BUILDPLATFORM.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web-deps
WORKDIR /app
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY . .
RUN pnpm install --frozen-lockfile

FROM --platform=$BUILDPLATFORM web-deps AS web-build
ARG INTERNAL_API_URL
ENV NEXT_TELEMETRY_DISABLED=1 \
    INTERNAL_API_URL=${INTERNAL_API_URL}
RUN pnpm --filter @izandesk/shared-types build \
 && pnpm --filter web build \
 && cp -R apps/web/public apps/web/.next/standalone/apps/web/ \
 && cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/

# Native modules (bcrypt) must be compiled for the target architecture.
FROM ${NODE_IMAGE} AS api-build
WORKDIR /app
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN apk add --no-cache python3 make g++ \
 && corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @izandesk/shared-types build \
 && pnpm --filter api build \
 && pnpm --filter api deploy --prod /out/api

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache \
      bash tini su-exec \
      postgresql18 postgresql18-client postgresql18-contrib \
      postgis redis \
      bind-tools net-snmp-tools \
 && mkdir -p /data/postgres /data/redis /data/uploads /app/web /var/run/postgresql \
 && chown -R postgres:postgres /data/postgres /var/run/postgresql \
 && chown -R redis:redis /data/redis

WORKDIR /app/api
COPY --from=api-build /out/api ./
COPY --from=web-build /app/apps/web/.next/standalone/ /app/web/
# Bundled plugins are outside the api package and are not part of `pnpm deploy`.
COPY plugins/ /plugins/
COPY docker/allinone/entrypoint.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh \
 && ln -s /data/uploads /app/uploads

ENV NODE_ENV=production \
    API_PORT=4000 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    DB_HOST=127.0.0.1 \
    DB_PORT=5432 \
    DB_NAME=izandesk \
    DB_USER=izandesk_user \
    REDIS_HOST=127.0.0.1 \
    REDIS_PORT=6379 \
    PGDATA=/data/postgres \
    PLUGINS_DIR=/plugins \
    NODE_OPTIONS=--max-old-space-size=160

VOLUME /data
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/start.sh"]
