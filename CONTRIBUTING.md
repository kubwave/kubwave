# Contributing to kubwave

Thanks for your interest in contributing to kubwave — a self-hosted PaaS that deploys tenant applications onto Kubernetes.

## Table of Contents

- [What you'll need](#what-youll-need)
- [First-time dev setup](#first-time-dev-setup)
- [What's in this repo](#whats-in-this-repo)
- [Making changes](#making-changes)
- [Commit conventions](#commit-conventions)
- [Pull request process](#pull-request-process)
- [Code conventions](#code-conventions)
- [Testing](#testing)
- [Docs](#docs)
- [Where to get help](#where-to-get-help)

## What you'll need

- **Bun** ≥ 1.3.14 — runtime, package manager, and test runner
- **Docker** — for building container images
- **k3d** — local Kubernetes (the dev script manages this for you)
- **Tilt** (`brew install tilt-dev/tap/tilt`) — local dev orchestrator
- **Helm** ≥ 3.16 — for the platform chart

The fastest way to verify your setup is to run the full local stack once:

```sh
bun install
bun run dev          # k3d + Tilt — backend API + console + backend worker + db
```

## First-time dev setup

```sh
# 1. Clone & install
git clone https://github.com/kubwave/kubwave.git
cd kubwave
bun install

# 2. Run the full local stack (k3d + Tilt)
bun run dev

# 3. Just the docs site
bun run --filter=docs dev
```

Hostnames (via Traefik on `:80`):

- `http://console.localhost` — Web console (Nuxt 4 SSR)
- `/api` on `http://console.localhost` — NestJS API routed same-origin through Traefik
- `http://docs.localhost:4321` — Docs (Astro dev server)

## What's in this repo

A Bun + Turborepo monorepo with three decoupled workloads and shared packages:

| Path                 | What                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `apps/backend`       | NestJS on Node 24 — API and worker entrypoints                                |
| `apps/console`       | Nuxt 4 web console (Nitro SSR, Vue 3, shadcn-vue)                             |
| `apps/cli`           | Bun-compiled single-binary CLI with embedded Helm chart                       |
| `apps/docs`          | Astro + Starlight docs site                                                   |
| `packages/*`         | Shared source-only packages: `@kubwave/{api-client,crypto,db,kube,templates}` |
| `infra/helm/kubwave` | The Helm chart — single source of truth for K8s manifests                     |

## Making changes

The high-level workflow depends on what you're changing. The
[developer docs cookbook](./AGENTS.md#cookbook) covers
the exact steps for each area:

| Change                            | Start here                                                     |
| --------------------------------- | -------------------------------------------------------------- |
| New API endpoint                  | [`AGENTS.md` cookbook](./AGENTS.md#cookbook)                   |
| New console page / feature        | [`AGENTS.md` cookbook](./AGENTS.md#cookbook)                   |
| New service type / deployer       | [`AGENTS.md` cookbook](./AGENTS.md#cookbook)                   |
| New DB table or column            | [`AGENTS.md` cookbook](./AGENTS.md#cookbook)                   |
| New chart value the platform sets | See [Helm-values-mirroring rule](./AGENTS.md#helm-chart-shape) |

### Quick-check your work

```sh
bun run format:check    # Prettier
bun run lint            # oxlint
bun run check-types     # tsc — depends on a prior build
bun run test            # all workspace test suites
```

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short summary

Optional body explaining the why.
```

| Type       | When                                     |
| ---------- | ---------------------------------------- |
| `feat`     | A new feature                            |
| `fix`      | A bug fix                                |
| `docs`     | Documentation-only changes               |
| `chore`    | Build, tooling, CI, deps                 |
| `refactor` | Code change that neither fixes nor adds  |
| `test`     | Adding or updating tests                 |
| `style`    | Formatting, whitespace (no logic change) |

Scopes are optional but encouraged: `api`, `console`, `worker`, `cli`, `docs`, `helm`, `db`.

Examples:

- `feat(api): add team-scoped access tokens`
- `fix(worker): prevent reconcile deadlock on HA failover`
- `docs: add contributing guide and code of conduct`

## Pull request process

1. **Branch** from `main` (`feat/my-feature`, `fix/short-description`).
2. **Write** your changes, keeping commits small and well-scoped.
3. **Run** `bun run format:check && bun run lint && bun run check-types && bun run test`.
4. **Open a PR** against `main` with a short description and any relevant issue links.
5. CI will run the same checks plus an install verification on a fresh kind cluster.
6. A maintainer will review. Address feedback, then a maintainer merges.

Keep PRs focused — one concern per PR makes review faster.

## Code conventions

See [`AGENTS.md`](./AGENTS.md) for the full per-workspace conventions. Highlights:

- **TypeScript 6** with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` everywhere.
- **Backend API** → NestJS controllers stay thin; services own business logic; errors use the shared `{ error, details? }` shape.
- **OpenAPI client** → generated from Nest OpenAPI into `@kubwave/api-client`; the Console should not hand-write API response types.
- **Console** → shadcn-vue components (Reka UI primitives, Tailwind v4), forms with vee-validate + zod, TanStack Vue Query v5.
- **Backend worker** → separate Nest application context, single-flight reconcile, `FOR UPDATE SKIP LOCKED`, HA-safe.
- **Helm values** are mirrored in three places — [`AGENTS.md`](./AGENTS.md#helm-chart-shape) explains the rule.

## Testing

Run all workspace test suites from the repo root:

```sh
bun run test
```

> **Note:** The `backend` test suite reads `DATABASE_URL` from the environment and fails if it is unset. For a local run that doesn't touch a real database, export the same dummy value CI uses:
>
> ```sh
> export DATABASE_URL=postgres://test:test@127.0.0.1:5432/test
> ```

For focused runs, filter to the workspace you changed:

```sh
bun run --filter=cli test
bun run --filter=backend test
```

Most workspace test scripts already pass `--isolate` where Bun module mocks are involved. If you invoke `bun test` directly from a workspace, mirror that workspace's package script.

## Docs

- **User docs** live in [`apps/docs/src/content/docs/`](./apps/docs/src/content/docs/) (Astro + Starlight, MDX).
- Site conventions: [`AGENTS.md § Docs site conventions`](./AGENTS.md#docs-site).

To edit the public docs locally:

```sh
bun run --filter=docs dev
```

The Sidebar is hand-maintained in [`apps/docs/astro.config.mjs`](./apps/docs/astro.config.mjs). Add new pages there.

## Where to get help

- [`AGENTS.md`](./AGENTS.md) — the canonical, fast-moving repo reference
- [GitHub Issues](https://github.com/kubwave/kubwave/issues)
- [User documentation](https://docs.kubwave.com)

This project adheres to a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
