# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.14-alpine AS dev
RUN apk add --no-cache docker-cli tar
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/build-agent ./apps/build-agent
COPY packages/build-protocol ./packages/build-protocol
RUN mkdir -p apps/build-agent/node_modules/@kubwave && ln -s /app/packages/build-protocol apps/build-agent/node_modules/@kubwave/build-protocol
RUN bun build apps/build-agent/src/main.ts --target=bun --outfile=/app/agent.js
CMD ["bun", "/app/agent.js"]

FROM dev AS prod
ARG KUBWAVE_VERSION=dev
ENV KUBWAVE_VERSION=$KUBWAVE_VERSION
