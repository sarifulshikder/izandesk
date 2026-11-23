# syntax=docker/dockerfile:1.7
# Multi-arch web image: linux/amd64, linux/arm64, linux/arm/v7.
# Next.js 16 has no linux/arm/v7 SWC binary, so the build always runs on the
# host (BUILDPLATFORM); only the architecture-independent standalone output is
# copied into the target runtime. Set INTERNAL_API_URL at build time when the
# API container is not reachable on localhost:4000 (e.g. http://api:4000).
ARG NODE_IMAGE=node:22-alpine
ARG INTERNAL_API_URL=http://localhost:4000

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV COREPACK_DEFAULT_TO_LATEST=0
# pnpm 10+ ships only native binaries and has none for linux/arm; 9.x is pure JS and reads lockfile v9.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY . .
RUN pnpm install --frozen-lockfile

FROM --platform=$BUILDPLATFORM deps AS build
ARG INTERNAL_API_URL
ENV NEXT_TELEMETRY_DISABLED=1 \
    INTERNAL_API_URL=${INTERNAL_API_URL}
RUN pnpm --filter @izandesk/shared-types build \
 && pnpm --filter web build \
 && cp -R apps/web/public apps/web/.next/standalone/apps/web/ \
 && cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone/ ./
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
