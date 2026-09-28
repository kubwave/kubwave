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
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/docs ./apps/docs
EXPOSE 4321
ENV PORT=4321 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/docs
CMD ["node", "node_modules/.bin/next", "dev", "--port", "4321", "--hostname", "0.0.0.0"]

FROM node:24-alpine AS build
# Release line baked into the static export: "latest" (stable) or "next" (prerelease).
ARG NEXT_PUBLIC_DOCS_CHANNEL=latest
ENV NEXT_PUBLIC_DOCS_CHANNEL=${NEXT_PUBLIC_DOCS_CHANNEL} NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app ./
COPY apps/docs ./apps/docs
WORKDIR /app/apps/docs
RUN node node_modules/.bin/next build

# Last stage, so plain `docker build` (and kubwave's Dockerfile builder) produce the site image.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS prod
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/docs/out /usr/share/nginx/html
EXPOSE 8080
