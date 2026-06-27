# syntax=docker/dockerfile:1.7

# Dev-only image: in prod the static build ships to Cloudflare (wrangler.jsonc),
# so there is no build/prod stage here — just `astro dev` with source synced by Tilt.

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

# ---- dev: astro dev, source synced by Tilt ----
FROM oven/bun:1.3.14-alpine AS dev
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/docs ./apps/docs
# sharp ships prebuilt binaries skipped by --ignore-scripts above; astro dev
# doesn't need image optimization, so this is fine for the dev loop.
EXPOSE 4321
WORKDIR /app/apps/docs
CMD ["bun", "run", "astro", "dev", "--host", "0.0.0.0", "--port", "4321"]
