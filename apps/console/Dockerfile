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

# ---- dev: nuxt dev, source synced by Tilt ----
# Runs on node, NOT bun. Under the bun runtime (oven/bun:alpine) the Nuxt 4 / Vite 7 dev server
# pegs a CPU core at 100% right after "warmed up" and never serves HTTP — the event loop stays
# saturated, so /health times out and the startup probe crash-loops the pod. Real node serves in
# seconds and idles at ~0% (verified: same image/code, only the runtime differs). node_modules is
# bun-installed in `deps` but runs fine under node, same as the backend dev stage.
FROM node:24-alpine AS dev
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/backend ./apps/backend
COPY apps/console ./apps/console
EXPOSE 3000
ENV PORT=3000 NUXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/console
CMD ["node", "node_modules/.bin/nuxt", "dev", "--port", "3000", "--host", "0.0.0.0"]

# ---- build: deps under bun (turbo), then nuxt build under node → .output ----
# Base stays the bun image because console's workspace deps build with bun scripts
# (api-client runs `bun run … openapi:generate` + `bun scripts/…`). But the final
# `nuxt build` MUST run under node: under the bun runtime the Nuxt 4 / Vite 7 build
# pegs a CPU core at 100% during the client "transforming…" phase and never finishes —
# the same hang that moved the dev server to node. So we add a real node and pin step 2
# to it; only the upstream `^build` tasks (the OpenAPI client) run under bun via turbo.
FROM oven/bun:1.3.14-alpine AS build
RUN apk add --no-cache nodejs
WORKDIR /app
# Turbo remote cache creds — same wiring as apps/cli/Dockerfile. The runner sets
# these as build-args/secret; without declaring them here the in-image `turbo run`
# has no token and logs "Remote caching disabled".
ARG TURBO_TEAM
ARG TURBO_API
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/backend ./apps/backend
COPY apps/console ./apps/console
ENV NUXT_TELEMETRY_DISABLED=1
# 1) Build console's workspace dependencies (the OpenAPI client) under bun via turbo.
RUN --mount=type=secret,id=turbo_token,required=false \
	if [ -s /run/secrets/turbo_token ]; then TURBO_TOKEN="$(cat /run/secrets/turbo_token)"; export TURBO_TOKEN; fi; \
	if [ -n "$TURBO_TEAM" ]; then export TURBO_TEAM; fi; \
	if [ -n "$TURBO_API" ]; then export TURBO_API; fi; \
	bun run turbo run build --filter='console^...'
# 2) Run the Nuxt / Vite build itself under node, NOT bun (see header). Mirrors the dev
# stage's `node node_modules/.bin/nuxt …` invocation.
WORKDIR /app/apps/console
RUN node node_modules/.bin/nuxt build

# ---- prod: Node runtime, Nitro server (self-contained .output) ----
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 NUXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/console/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
