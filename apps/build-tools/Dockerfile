# syntax=docker/dockerfile:1.7

FROM alpine:3.22 AS prod

ARG NIXPACKS_VERSION=1.41.0
ARG TARGETARCH

RUN apk add --no-cache ca-certificates git openssh-client curl tar \
	&& case "${TARGETARCH:-$(apk --print-arch)}" in \
		amd64|x86_64) NIXARCH=x86_64 ;; \
		arm64|aarch64) NIXARCH=aarch64 ;; \
		*) echo "unsupported architecture: ${TARGETARCH:-$(apk --print-arch)}" >&2; exit 1 ;; \
	esac \
	&& curl -fsSL "https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-${NIXARCH}-unknown-linux-musl.tar.gz" -o /tmp/nixpacks.tar.gz \
	&& tar -xz -C /usr/local/bin -f /tmp/nixpacks.tar.gz nixpacks \
	&& chmod +x /usr/local/bin/nixpacks \
	&& rm -f /tmp/nixpacks.tar.gz

