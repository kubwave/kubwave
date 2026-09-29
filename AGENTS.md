# AGENTS.md - repo-specific guidance for OpenCode / Claude Code

## What This Is

`kubwave` is a self-hosted PaaS control plane. It is a Bun-managed Turborepo monorepo with three runtime workloads:

- backend API - NestJS on Node 24, exposed under `/api`
- console - Next.js 16 (App Router, React 19)
- backend worker - NestJS application context, no public API

The API and worker share the `apps/backend` codebase and image, but they stay separate Kubernetes Deployments with separate commands, ServiceAccounts, and RBAC. Do not collapse them into one runtime process.

The console is Next.js 16 with React 19. Do not reintroduce the Nuxt console, and do not resurrect the deleted `infra/k8s/` Kustomize tree. The public docs (`apps/docs`) are a separate Next.js app.

## Directory Layout

```text
apps/
  backend     - NestJS API + worker entrypoints.
  console     - Next.js 16 (App Router, standalone server) + shadcn/ui + TanStack Query/Form.
  cli         - Bun single-binary installer (ships embedded Helm chart).
  docs        - Next.js + MDX public docs, static export (runs as a kubwave service, not part of the chart).
  build-tools - source-build helper image inputs.
packages/
  api-client  - @kubwave/api-client generated from backend OpenAPI.
  db          - Drizzle schema, client (db, sql), migrations.
  kube        - @kubernetes/client-node config + workload helpers.
  crypto      - AES-256-GCM encrypt/decrypt for per-service secrets.
  templates   - service template catalog (catalog.json) + per-template manifests.
infra/helm/kubwave - single source of truth for Kubernetes manifests.
```

There is no `packages/core` or `@kubwave/core`. Backend domain errors extend `ApiError` from `apps/backend/src/shared/errors/api-error.ts`.

## Runtime Workloads

- **Backend API** - `apps/backend/src/main-api.ts`. NestJS + Fastify adapter. Auth authority: mints JWT access tokens and opaque refresh tokens. Requires `JWT_SECRET`. Routes are served under `/api`; OpenAPI is published at `/api/openapi.json`, Swagger UI at `/api/docs`. Runs DB migrations on boot. Kubernetes RBAC is read-only.

- **Console** - `apps/console`. Next.js 16 App Router (`output: 'standalone'`), React 19, TanStack Query v5 and TanStack Form, shadcn/ui (Radix) on Tailwind v4. Consumes the API through `@kubwave/api-client`. Browser traffic uses same-origin `/api`; server rendering uses `INTERNAL_API_URL` plus the access token handed over by `proxy.ts`.

- **Backend worker** - `apps/backend/src/main-worker.ts`. Nest application context plus a small health server on `:8080`. It runs scheduler jobs, deployment reconcile, build logs, self-update lifecycle, Git pollers, PR previews, registry maintenance, and platform reconcile. It does not require `JWT_SECRET`. Kubernetes RBAC is read-write.

## Commands And Verification Order

```sh
bun install
bun run dev
bun run dev:local
bun run build
bun run format:check
bun run lint
bun run check-types
bun run test
```

Database commands, run from the repo root:

```sh
bun run --filter=@kubwave/db db:generate
bun run --filter=@kubwave/db db:migrate
bun run --filter=@kubwave/db db:studio
```

Focused workspace commands:

```sh
bun run --filter=backend dev
bun run --filter=backend dev:worker
bun run --filter=backend test
bun run --filter=@kubwave/api-client build
bun run --filter=console dev
bun run --filter=cli test
bun run --filter=docs dev
```

`packages/api-client` builds by generating `packages/api-client/openapi.json` from `apps/backend/src/generate-openapi.ts`, then running `@hey-api/openapi-ts`.

## Local Dev Architecture

`bun run dev` runs `scripts/dev.sh`:

1. Recreates the `kubwave` k3d cluster from `infra/k3d/cluster.yaml`.
2. Waits for Traefik Deployment and CRDs (`middlewares.traefik.io`, `ingressroutes.traefik.io`, `ingressroutetcps.traefik.io`).
3. Ensures namespace `kubwave` exists.
4. Runs `tilt up`.

Do not run `kubectl apply` or `helm upgrade` while Tilt runs. Tilt owns rendered output and image-tag rewriting.

Hostnames:

- `http://console.localhost` - the console UI; `/api/...` routes to the backend API.
- Tilt port-forwards: console `:3000`, API `:3001`, Adminer `:8080`.

## Helm Chart Shape

`infra/helm/kubwave` is the single source of truth for cluster manifests. The chart still renders `api` and `worker` Kubernetes resources for upgrade compatibility, but both use the backend image with different `BACKEND_ENTRYPOINT` values:

- API Deployment: `BACKEND_ENTRYPOINT=api`, port `3001`, read-only RBAC.
- Worker Deployment: `BACKEND_ENTRYPOINT=worker`, health port `8080`, read-write RBAC.

Important template folders:

| dir         | renders                                                                             | notes                                       |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `api/`      | Deployment + Service + read-only RBAC + ServiceAccount + dev `console-creds` Secret | mounts `JWT_SECRET`, `SECRETS_KEY`          |
| `worker/`   | Deployment + read-write RBAC + ServiceAccount                                       | owns tenant namespaces and self-update Jobs |
| `console/`  | Deployment + Service + Ingress                                                      | no ServiceAccount; talks only to API        |
| `postgres/` | StatefulSet/headless Service/PVC or CNPG wiring                                     | platform state                              |
| `registry/` | Registry Deployment/Service/PVC/Ingress                                             | build image storage                         |
| `builder/`  | BuildKit build RBAC/ServiceAccount                                                  | in-cluster source and Dockerfile builds     |
| `update/`   | self-update Job template ConfigMap + RBAC                                           | worker creates the actual Jobs              |

Helm values that the platform sets must stay mirrored in:

1. install - `buildValues()` / `buildProductionValues()` in `apps/cli/src/lib/helm.ts`
2. update - `buildUpgradeValues()` in `apps/cli/src/lib/upgrade-plan.ts`
3. in-cluster self-update Job - `infra/helm/kubwave/templates/update/job-template.yaml`

Update the CLI Helm tests when those values change.

## Code Comments

Keep comments minimal. Write code that explains itself through clear naming instead of narrating it with comments.

- Add a comment only when the _why_ is non-obvious (a workaround, a subtle invariant, a non-trivial decision). Never comment _what_ the code already says.
- When a comment is genuinely needed, keep it to 1 line, 2 at most.
- Do not add section-divider banners, restating-the-obvious comments, or step-by-step narration.
- Do not leave commented-out code.

## Backend Conventions

`apps/backend/src` is split by runtime and responsibility:

```text
main-api.ts       - API bootstrap, migrations, OpenAPI, Fastify listen.
main-worker.ts    - worker bootstrap, app context, scheduler, health server.
api.module.ts     - HTTP API module graph.
worker.module.ts  - worker-only module graph.
modules/          - domain modules.
shared/           - config, db, errors, auth, cookies, validation, openapi, scheduler, kube/cluster, settings, logging-style helpers.
```

Controller rules:

- Controllers stay thin: route decorators, guards, DTO validation, and delegation to services.
- Services own business logic and Drizzle queries.
- Do not add generic repository abstractions around Drizzle.
- Keep response mapping explicit; avoid hidden auto-mapping layers.
- Use the shared error shape `{ error: string, details?: unknown }`.
- Use `ZodValidationPipe`/DTO schemas for request validation and OpenAPI metadata.
- Give every public route a stable `operationId`.

Current module groups:

- `auth`, `setup`, `health`
- `teams`, `projects`, `environments`, `services`, `deployments`
- `git`, `templates`, `invitations`
- `platform` (`users`, `settings/*`, `version`, `updates`)
- `worker`

Worker jobs live under `apps/backend/src/modules/worker/jobs`. They should use shared domain services or shared helpers directly, not HTTP calls to the API.

## API Client

`packages/api-client` is the only typed client used by the Console and other TypeScript consumers.

- Source of truth: Nest OpenAPI generated from `apps/backend`.
- Generator: `@hey-api/openapi-ts`.
- Package name: `@kubwave/api-client`.
- Runtime wrapper: `createKubwaveSdkClient()` / `createKubwaveClient()` in `packages/api-client/src/runtime`.

Do not reintroduce type imports from backend internals in the Console. Domain view types should come from `@kubwave/api-client` or thin local aliases that derive from it.

## Auth Model

The backend API is the auth authority. It issues short-lived JWT access tokens (`Authorization: Bearer`) and opaque refresh tokens stored as HttpOnly cookies. Refresh rotation lives in the backend auth module.

Console keeps access tokens in memory only. SSR refresh happens in `apps/console/proxy.ts` (Next.js proxy, Node runtime): on document requests only, it exchanges the refresh cookie for an access token, relays any rotated cookie, decides redirects (login, setup) via `lib/auth/route-policy.ts`, and forwards the access token to server rendering in the internal `x-kubwave-access-token` request header (any client-sent copy is stripped). RSC and prefetch requests skip the exchange so parallel navigations never race a rotation. The root layout passes the token to `SessionProvider`, which seeds the in-memory store in the browser; later refreshes are single-flight in `lib/auth/token-store.ts`.

Keep this flow intact. Storing access tokens in cookies, localStorage, or persistent browser storage is not acceptable.

## Console Conventions

- Routes live in `app/` (App Router). Pages are thin server components: they await `params`/`searchParams`, optionally seed React Query with `serverPrefetch()` (`lib/api/server-prefetch.ts`) inside a `HydrationBoundary`, and render one feature component.
- Feature code lives in `features/<domain>` (client components, hooks, pure `model.ts` logic). Shared building blocks live in `components/`; shadcn/ui primitives in `components/ui` (Radix via `radix-ui`), icons from `lucide-react`, forms via TanStack Form + zod. Design tokens live in `app/globals.css`.
- Query keys live in `lib/api/query-keys.ts`. `getBrowserApi()` (`lib/api/browser-api.ts`) and `getServerApi()` (`lib/api/server-api.ts`) wrap `@kubwave/api-client`.
- Types in `lib/api/types.ts` derive from `@kubwave/api-client`.
- Pure logic is tested first with `bun test` under `apps/console/test`.
- `proxy.ts` is the SSR auth proxy; in dev, `next.config.ts` rewrites `/api` to `INTERNAL_API_URL`.

## Packages

- `@kubwave/db` - Drizzle schema, migrations, `db`, `sql`, `createDb()`, service config types, default-domain helpers.
- `@kubwave/kube` - kube config, Kubernetes naming helpers, workload helpers, metrics helpers.
- `@kubwave/crypto` - secret encryption/decryption and SSH key helpers.
- `@kubwave/api-client` - generated OpenAPI client plus the Kubwave wrapper.
- `@kubwave/templates` - service template catalog (catalog.json) and per-template Kubernetes manifests, consumed by the worker.

## Cookbook

**New API endpoint** - add a controller method under `apps/backend/src/modules/<domain>`, define DTO/schema metadata, guard it as needed, delegate to a service, and add a stable `operationId`. If the endpoint is consumed by TypeScript clients, regenerate `@kubwave/api-client`.

**New console feature/page** - add `app/(app)/.../page.tsx` as a thin server component and put the UI in `features/<domain>`. Use React Query with `queryKeys`, call the generated API client through `getBrowserApi()`, and derive response types from `@kubwave/api-client`.

**New service type/deployer** - extend `ServiceType` and config shapes in `@kubwave/db`, implement the deployer under `apps/backend/src/modules/worker/jobs/deployments/deployers`, register it in the deployer registry, and add the Console create/settings UI.

**New DB table/column** - edit `packages/db/src/schema.ts`, run `bun run --filter=@kubwave/db db:generate`, and add/update focused tests.

**New per-service secret/config field** - update the DB service config type, backend validation/mapping, Console forms, and worker runtime convergence. API encrypts on write; worker decrypts when creating Kubernetes Secrets.

**New chart value the platform sets** - update `buildProductionValues()`, `buildUpgradeValues()` if needed, the self-update Job template, Helm templates/values, and CLI render tests.

**New backend env var** - add it to `apps/backend/src/shared/config/backend-config.service.ts` for API/shared settings or `apps/backend/src/shared/config/worker-env.ts` for worker-only settings, then wire Helm and docs.

## Toolchain Quirks

- TypeScript 6.0.3, Bun 1.3.14, Node >= 24.
- `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on.
- Next.js apps (`apps/console`, `apps/docs`) carry their own `AGENTS.md`/`CLAUDE.md` with the managed `nextjs-agent-rules` block, which `next dev` keeps current: read the version-matched docs in `apps/<app>/node_modules/next/dist/docs/` before writing Next.js code. The `next-devtools` MCP server in `.mcp.json` reads compilation issues, routes and logs from a running `next dev`.
- Console alias: `@/*` points to `apps/console/*`. `@kubwave/api-client` uses extensionless relative imports so Turbopack can resolve it.
- CLI needs pre-build stubs: `bun run --filter=cli _prepare-embedded`.
- Dockerfiles for `backend`, `console`, `docs`, and `cli` have `dev` and `prod` targets.
- Tilt live updates sync source; package/config changes trigger rebuilds.

## Docs Site

`apps/docs` is Next.js (App Router, `output: 'export'`) with MDX via `@next/mdx`, shadcn/ui, and Tailwind v4. Pages live in `content/**/*.mdx`, each exporting `metadata = { title, description }`; the URL is the file path. The sidebar and prev/next order are `lib/nav.ts`, and `bun run --filter=docs test` fails when a page is missing from it. MDX components (`Callout`, `Tabs`/`Tab`, `Steps`, `Cards`/`Card`, `LinkCard`, `InstallCommand`) are registered in `mdx-components.tsx`. Search reads a static `/search.json` built from the MDX sources (`lib/search-index.ts`). `NEXT_PUBLIC_DOCS_CHANNEL` (`latest`/`next`) is baked in at build time and drives the version switcher and install command. The Dockerfile `prod` target (last stage) serves `out/` with nginx on `:8080`. `.github/workflows/docs-image.yml` pushes it as `ghcr.io/kubwave/docs:latest` (stable) or `:next` (prerelease), called by `release.yml` or run by hand to republish without a release; the `kubwave-docs` project on the kubwave cluster runs those tags with image watch (docs.kubwave.com, docs-next.kubwave.com) plus a `preview` environment that builds `main` with PR previews. The chart only runs `next dev` for local dev. The docs site is English-only for v1.

## Release Model

- Tags do not use a `v` prefix (`1.2.3`, not `v1.2.3`).
- Stable tags push `:latest`; prerelease tags do not.
- `bun.lock` is committed; CI installs with `--frozen-lockfile`.
- Dev `values.yaml` uses `pullPolicy: Never` and tag `dev`; do not deploy it to a real cluster.
