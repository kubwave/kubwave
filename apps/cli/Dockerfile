# syntax=docker/dockerfile:1.7

# ---- deps: install workspace dependencies ----
FROM oven/bun:1.3.14-slim AS deps
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

ARG KUBWAVE_VERSION=dev

# ---- dev: hot-reload via bun --hot ----
FROM oven/bun:1.3.14-slim AS dev
WORKDIR /app
COPY --from=deps /app ./
COPY apps/cli/tsconfig.json ./apps/cli/
COPY apps/cli/src ./apps/cli/src
COPY packages/crypto/src ./packages/crypto/src
COPY packages/kube/src ./packages/kube/src
# Dev: empty placeholders are enough — embedded.ts falls back to system helm + dev chart.
RUN mkdir -p apps/cli/build/embedded \
	&& touch apps/cli/build/embedded/helm apps/cli/build/embedded/chart.tgz
WORKDIR /app/apps/cli
CMD ["bun", "run", "--hot", "src/index.ts"]

# ---- builder: compile a self-contained binary ----
FROM oven/bun:1.3.14-slim AS builder
ARG KUBWAVE_VERSION
ARG TURBO_TEAM
ARG TURBO_API
# Keep in sync with HELM_VERSION in .github/workflows/release.yml.
ARG HELM_VERSION=3.16.4
WORKDIR /app
COPY --from=deps /app ./
COPY apps/cli/tsconfig.json ./apps/cli/
COPY apps/cli/src ./apps/cli/src
COPY packages/crypto/src ./packages/crypto/src
COPY packages/kube/src ./packages/kube/src
COPY infra/helm/kubwave /tmp/chart
# Embed the real Helm binary + packaged chart so the in-cluster update Job — which
# runs THIS image (ghcr.io/.../cli) and shells out to helm for dependency installs
# and `helm upgrade` — is self-contained. The distroless runtime has no system
# helm, so empty placeholders here make in-cluster updates fail. The image is
# linux/amd64 only (build:docker compiles bun-linux-x64-baseline), so we fetch the
# linux-amd64 helm to match.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p apps/cli/build/embedded \
	&& curl -fsSL "https://get.helm.sh/helm-v${HELM_VERSION}-linux-amd64.tar.gz" -o /tmp/helm.tgz \
	&& tar xzf /tmp/helm.tgz -C /tmp \
	&& install -m 0755 /tmp/linux-amd64/helm apps/cli/build/embedded/helm \
	&& CHART_APP_VERSION="${KUBWAVE_VERSION:-dev}" \
	&& if printf '%s' "${CHART_APP_VERSION}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then CHART_VERSION="${CHART_APP_VERSION}"; else CHART_VERSION="0.0.0-dev"; fi \
	&& apps/cli/build/embedded/helm package /tmp/chart \
		--version "${CHART_VERSION}" \
		--app-version "${CHART_APP_VERSION}" \
		--destination /tmp/chartpkg \
	&& cp /tmp/chartpkg/*.tgz apps/cli/build/embedded/chart.tgz \
	&& apps/cli/build/embedded/helm show chart apps/cli/build/embedded/chart.tgz > /tmp/embedded-chart.yaml \
	&& grep -Fx "version: ${CHART_VERSION}" /tmp/embedded-chart.yaml \
	&& grep -Fx "appVersion: ${CHART_APP_VERSION}" /tmp/embedded-chart.yaml
RUN --mount=type=secret,id=turbo_token,required=false \
	KUBWAVE_VERSION="${KUBWAVE_VERSION:-dev}"; \
	KUBWAVE_HELM_VERSION="${HELM_VERSION}"; \
	export KUBWAVE_VERSION KUBWAVE_HELM_VERSION; \
	if [ -s /run/secrets/turbo_token ]; then TURBO_TOKEN="$(cat /run/secrets/turbo_token)"; export TURBO_TOKEN; fi; \
	if [ -n "$TURBO_TEAM" ]; then export TURBO_TEAM; fi; \
	if [ -n "$TURBO_API" ]; then export TURBO_API; fi; \
	bun run turbo run build:docker --filter=./apps/cli --only

# ---- prod: distroless runtime ----
FROM gcr.io/distroless/cc-debian12:nonroot AS prod
COPY --from=builder /app/apps/cli/dist/kubwave /usr/local/bin/kubwave
# Also place helm on the (read-only but executable) root fs. The in-cluster update
# Job runs with readOnlyRootFilesystem + a writable /tmp that may be mounted noexec,
# so the CLI execs this baked-in helm (via KUBWAVE_HELM_BIN) instead of
# extracting the embedded copy onto /tmp. helm is a static binary, so it runs here.
COPY --chmod=0755 --from=builder /app/apps/cli/build/embedded/helm /usr/local/bin/helm
USER 1000
ENTRYPOINT ["kubwave"]
