# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

[AGENTS.md](./AGENTS.md) is the authoritative, detailed guide for this repo: directory layout, per-workload conventions, the auth model, the Cookbook for common changes, and toolchain quirks. This file is the quick orientation; consult AGENTS.md before non-trivial work and treat it as the source of truth where the two overlap.

## What this is

`kubwave` is an open-source, self-hosted PaaS control plane for Kubernetes. It's a Bun-managed Turborepo monorepo (`bun@1.3.14`, Node >= 24, TypeScript 6). Packager is Bun; do not use npm/yarn/pnpm.

## Architecture in one picture

Three runtime workloads plus shared packages. The single most important structural fact: **the backend API and the backend worker share `apps/backend` code and image but run as separate Kubernetes Deployments** selected by `BACKEND_ENTRYPOINT` (`api` vs `worker`). Never collapse them into one process.

- `apps/backend` — NestJS on Node 24. `main-api.ts` is the REST API + auth authority (mints JWTs, runs DB migrations on boot, read-only k8s RBAC, served under `/api`). `main-worker.ts` is a Nest app context running reconcilers/schedulers/build jobs (read-write k8s RBAC, no `JWT_SECRET`, health server on `:8080`).
- `apps/console` — Nuxt 4 / Vue 3 / Nitro SSR, shadcn-vue (Reka UI) on Tailwind v4, TanStack Vue Query. Talks to the API only through `@kubwave/api-client`. Browser uses same-origin `/api`; SSR uses `INTERNAL_API_URL`.
- `apps/cli` — Bun single-binary installer with the Helm chart embedded.
- `apps/docs` — Nuxt 4 + Nuxt Content public docs (not deployed in-cluster).
- `packages/*` — source-only shared packages: `@kubwave/{api-client,crypto,db,kube,templates}`.
- `infra/helm/kubwave` — the Helm chart, single source of truth for what lands in a cluster.

Data flows one way for types: backend OpenAPI → `@kubwave/api-client` → console. The console must not import backend internals.

## Commands

```sh
bun install
bun run dev            # k3d + Tilt: full local stack (API + console + worker + db)
bun run build          # turbo build all
bun run lint           # oxlint --deny-warnings
bun run check-types    # turbo tsc --noEmit
bun run test           # turbo test (bun test under the hood)
bun run format:check   # prettier check
```

Focused workspace commands use `--filter`, e.g. `bun run --filter=backend dev`, `bun run --filter=backend dev:worker`, `bun run --filter=console dev`.

Database (Drizzle), from repo root:

```sh
bun run --filter=@kubwave/db db:generate   # after editing packages/db/src/schema.ts
bun run --filter=@kubwave/db db:migrate
bun run --filter=@kubwave/db db:studio
```

## Running a single test

Tests use **Bun's test runner** (`bun test`), not vitest/jest. From a workspace directory:

```sh
cd apps/backend && bun test test/path/to/file.test.ts   # one file
cd apps/backend && bun test -t "name substring"         # filter by test name
```

## Non-obvious rules

- **API client is generated.** `packages/api-client` builds by emitting `openapi.json` from `apps/backend/src/generate-openapi.ts`, then running `@hey-api/openapi-ts`. After changing API routes/DTOs consumed by TypeScript clients, regenerate it. Give every public route a stable `operationId`.
- **Helm values are mirrored in three places** — keep them in sync and update the CLI Helm tests when they change: `buildValues()`/`buildProductionValues()` in `apps/cli/src/lib/helm.ts`, `buildUpgradeValues()` in `apps/cli/src/lib/upgrade-plan.ts`, and `infra/helm/kubwave/templates/update/job-template.yaml`.
- **Don't touch the cluster while Tilt runs.** No `kubectl apply` / `helm upgrade` during `bun run dev` — Tilt owns rendered output and image-tag rewriting.
- **CLI needs stubs before building:** `bun run --filter=cli _prepare-embedded`.
- **Auth tokens:** access tokens live in memory (console) only; refresh tokens are opaque HttpOnly cookies. Never persist access tokens in cookies/localStorage. SSR refresh is in `apps/console/server/middleware/1.auth.ts`.
- **Controllers stay thin;** services own business logic and Drizzle queries. No repository abstractions over Drizzle. Shared error shape `{ error: string, details?: unknown }`; backend errors extend `ApiError` (`apps/backend/src/shared/errors/api-error.ts`).
- **Comments minimal** — only when the _why_ is non-obvious; no what-narration, no commented-out code, no banner dividers.
- **Do not resurrect** the old Next.js console, `packages/core`/`@kubwave/core`, or the deleted `infra/k8s/` Kustomize tree.

## Release

Tags have no `v` prefix (`1.2.3`). Stable tags push `:latest`; prereleases don't. `bun.lock` is committed; CI installs `--frozen-lockfile`.
