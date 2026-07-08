# syntax=docker/dockerfile:1.7

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

FROM node:24-alpine AS dev
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/docs ./apps/docs
RUN npm rebuild better-sqlite3
EXPOSE 4321
ENV PORT=4321 NUXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/docs
CMD ["node", "node_modules/.bin/nuxt", "dev", "--port", "4321", "--host", "0.0.0.0"]
