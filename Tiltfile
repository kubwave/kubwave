# Tiltfile — drives the local dev loop on top of a k3d cluster.
# Backend has two runtimes from one image: api (Nest HTTP) and worker
# (Nest application context). Console/docs are separate dev workloads.

# Enable image-rewriting & namespace inference for Helm-rendered output.
allow_k8s_contexts(['k3d-kubwave'])

_only = ['./apps', './packages', './package.json', './bun.lock', './turbo.json']
_deps = ['./bun.lock', './packages', './apps/backend/package.json', './apps/console/package.json', './packages/api-client/package.json']
_build_tools_host_image = 'localhost:5111/build-tools:dev'
_build_tools_cluster_image = 'kubwave-registry:5000/build-tools:dev'

# ---- build-tools (source clone + Nixpacks CLI image used by generated build Jobs) ----
local_resource(
    'build-tools',
    cmd='docker build --target prod -t %s -f apps/build-tools/Dockerfile . && docker push %s' % (_build_tools_host_image, _build_tools_host_image),
    deps=['./apps/build-tools/Dockerfile'],
    labels=['infra'],
)

# ---- backend (Nest API + worker runtime) ----
docker_build(
    'backend',
    context='.',
    dockerfile='./apps/backend/Dockerfile',
    target='dev',
    only=_only,
    live_update=[
        fall_back_on(_deps + ['./apps/backend/tsconfig.json', './apps/backend/Dockerfile']),
        sync('./apps/backend/src', '/app/apps/backend/src'),
    ],
)

# ---- console (Nuxt) — Vite HMR over synced app/server/public files ----
docker_build(
    'console',
    context='.',
    dockerfile='./apps/console/Dockerfile',
    target='dev',
    only=_only,
    live_update=[
        fall_back_on(_deps + ['./apps/console/tsconfig.json', './apps/console/nuxt.config.ts', './apps/console/Dockerfile']),
        sync('./apps/console/app', '/app/apps/console/app'),
        sync('./apps/console/server', '/app/apps/console/server'),
        sync('./apps/console/public', '/app/apps/console/public'),
    ],
)

# ---- docs (Astro Starlight) — astro dev / HMR over synced src files ----
# Dev-only workload: prod ships the static build to Cloudflare (apps/docs/wrangler.jsonc),
# so the chart gates it behind docs.enabled (true in dev values, false in prod).
docker_build(
    'docs',
    context='.',
    dockerfile='./apps/docs/Dockerfile',
    target='dev',
    only=_only,
    live_update=[
        fall_back_on(_deps + ['./apps/docs/package.json', './apps/docs/astro.config.mjs', './apps/docs/tsconfig.json', './apps/docs/Dockerfile']),
        sync('./apps/docs/src', '/app/apps/docs/src'),
        sync('./apps/docs/public', '/app/apps/docs/public'),
    ],
)

# ---- Helm chart (dev profile = default values) ----
# `set` re-pins the ingress IP to localhost: in k3d the cluster is reached via the
# host loopback (Traefik ports are host-mapped), not via the klipper LB IP. The chart
# default is now empty (auto-detect from the LB status) so a real cluster with a
# public LB doesn't silently route every auto-domain at 127.0.0.1.
# Forge token for PR-preview discovery: copy GITEA_TOKEN from the host env into the
# console-creds Secret so private-repo PR previews work in dev (Gitea returns 404 for a
# private repo without auth). Empty/unset → omitted (private-repo discovery then 404s).
# Put GITEA_TOKEN=<pat> in a gitignored project-root .env (scripts/dev.sh loads it), or
# export GITEA_TOKEN before `tilt up`.
gitea_token = os.getenv('GITEA_TOKEN', '')
if gitea_token:
    print('[dev] GITEA_TOKEN found in host env -> injected into console-creds (private-repo PR previews enabled)')
else:
    print('[dev] no GITEA_TOKEN in host env -> private-repo PR-preview discovery will 404; `export GITEA_TOKEN=<pat>` to enable')

k8s_yaml(helm(
    './infra/helm/kubwave',
    name='kubwave',
    namespace='kubwave',
    values=['./infra/helm/kubwave/values.yaml'],
    set=['workloadIngress.loadBalancerIp=127.0.0.1', 'builds.buildToolsImage=' + _build_tools_cluster_image] + (['api.secret.data.GITEA_TOKEN=' + gitea_token] if gitea_token else []),
))

# ---- Resource grouping & port-forwards ----
# Postgres is now a CloudNativePG `Cluster` CR (the operator is installed out-of-band by
# scripts/dev.sh into cnpg-system). The operator provisions the postgres-N pods + the
# postgres-rw Service at runtime, so there's no StatefulSet for Tilt to gate on; api/worker
# retry the DB connection on boot until postgres-rw is up. The Cluster CR is left to Tilt's
# default grouping (no resource_deps on it, so a wrong object selector can't wedge `tilt up`).
k8s_resource('api', port_forwards=['3001:3001'], labels=['app'])
k8s_resource('console', port_forwards=['3000:3000'], labels=['app'], resource_deps=['api'])
k8s_resource('docs', port_forwards=['4321:4321'], labels=['app'])
k8s_resource('worker', labels=['app'], resource_deps=['build-tools'])
k8s_resource('adminer', port_forwards=['8080:8080'], labels=['tools'])
k8s_resource('mailcrab', port_forwards=['1080:1080', '1025:1025'], labels=['tools'])
