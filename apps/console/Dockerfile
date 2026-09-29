# syntax=docker/dockerfile:1.7

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

# ---- dev: next dev, source synced by Tilt ----
# Runs on node, like the other dev stages: node_modules is bun-installed but the dev servers run under node.
FROM node:24-alpine AS dev
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/console ./apps/console
EXPOSE 3000
ENV PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/console
CMD ["node", "node_modules/.bin/next", "dev", "--port", "3000", "--hostname", "0.0.0.0"]

# ---- build: deps under bun (turbo), then next build under node → .next/standalone ----
# The bun base is kept because console's workspace deps build with bun scripts (the api-client
# regenerates from the backend's OpenAPI document); the Next build itself runs under node.
FROM oven/bun:1.3.14-alpine AS build
RUN apk add --no-cache nodejs
WORKDIR /app
# Turbo remote cache creds — same wiring as apps/cli/Dockerfile.
ARG TURBO_TEAM
ARG TURBO_API
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/backend ./apps/backend
COPY apps/console ./apps/console
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=turbo_token,required=false \
	if [ -s /run/secrets/turbo_token ]; then TURBO_TOKEN="$(cat /run/secrets/turbo_token)"; export TURBO_TOKEN; fi; \
	if [ -n "$TURBO_TEAM" ]; then export TURBO_TEAM; fi; \
	if [ -n "$TURBO_API" ]; then export TURBO_API; fi; \
	bun run turbo run build --filter='console^...'
WORKDIR /app/apps/console
RUN node node_modules/.bin/next build

# ---- prod: Node runtime, self-contained standalone server ----
# The standalone tree mirrors the monorepo, so the server lives at apps/console/server.js.
# Next reads HOSTNAME (not HOST) for the bind address.
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/console/.next/standalone ./
COPY --from=build /app/apps/console/.next/static ./apps/console/.next/static
COPY --from=build /app/apps/console/public ./apps/console/public
EXPOSE 3000
CMD ["node", "apps/console/server.js"]
