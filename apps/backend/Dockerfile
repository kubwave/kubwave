# ---- deps: install the whole workspace (frozen) ----
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/console/package.json ./apps/console/
COPY apps/cli/package.json ./apps/cli/
COPY apps/docs/package.json ./apps/docs/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/db/package.json ./packages/db/
COPY packages/kube/package.json ./packages/kube/
COPY packages/templates/package.json ./packages/templates/
RUN bun install --frozen-lockfile --ignore-scripts

# ---- runtime base: Node 24, no Bun runtime ----
FROM node:24-alpine AS runtime
RUN apk add --no-cache git openssh-client
WORKDIR /app
COPY --from=deps /app ./
COPY apps/backend ./apps/backend
COPY packages ./packages
ENV NODE_ENV=production BACKEND_ENTRYPOINT=api
WORKDIR /app/apps/backend

# ---- dev: SWC register loader + node --watch, source synced by Tilt ----
# SWC (not tsx/esbuild) because NestJS DI needs emitDecoratorMetadata, which esbuild
# does not implement; @swc-node/register emits design:paramtypes so injection works.
FROM runtime AS dev
ENV NODE_ENV=development API_PORT=3001 WORKER_HEALTH_PORT=8080
EXPOSE 3001 8080
CMD ["sh", "-c", "exec node --watch --import @swc-node/register/esm-register \"src/main-${BACKEND_ENTRYPOINT}.ts\""]

# ---- prod: Node 24 with the SWC register loader running workspace TypeScript sources ----
FROM runtime AS prod
USER node
ENV API_PORT=3001 WORKER_HEALTH_PORT=8080
EXPOSE 3001 8080
CMD ["sh", "-c", "exec node --import @swc-node/register/esm-register \"src/main-${BACKEND_ENTRYPOINT}.ts\""]
