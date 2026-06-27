# kubwave

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
  <a href="./CODE_OF_CONDUCT.md"><img src="https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg" alt="Contributor Covenant"></a>
  <a href="https://docs.kubwave.com"><img src="https://img.shields.io/badge/docs-kubwave.com-0892ab" alt="Documentation"></a>
</p>

An open-source, self-hosted PaaS for your apps. **One binary, any Kubernetes cluster, full control.**

> [!WARNING]
> **kubwave is under active development and not yet production-ready.** APIs, configuration, and data formats may change without notice, and breaking changes can land between releases. Use it for evaluation and testing — don't rely on it for production workloads yet.

---

## Quickstart

```sh
curl -fsSL https://get.kubwave.com | sh
kubwave install
```

On a ready cluster, that's it. The CLI walks you through platform selection, dependency installation (Traefik, cert-manager), and your domain — then the platform is live.

For a step-by-step walkthrough and non-interactive installs, see the [Quickstart guide](https://docs.kubwave.com/start/quickstart/).

Provider status:

- **Supported today:** Cloudfleet (Hetzner)
- **Coming soon:** Cloudfleet (AWS), Cloudfleet (Google Cloud), EKS, GKE, AKS, DigitalOcean, Vultr
- **Planned:** k3s with server management

Provider selection is cluster-wide: one kubwave cluster uses exactly one provider profile.

---

## Docs

The full user documentation lives at **[docs.kubwave.com](https://docs.kubwave.com)**. Source is in [`apps/docs/`](./apps/docs).

Start with:

- [Introduction](https://docs.kubwave.com/start/introduction/) — what kubwave is and who it's for
- [Quickstart](https://docs.kubwave.com/start/quickstart/) — install in 5 minutes
- [Supported providers](https://docs.kubwave.com/start/supported-providers/) — current, upcoming, and planned platform targets

## What's in this repo

A Bun + Turborepo monorepo. The platform runs as three decoupled workloads plus shared packages:

| Path                 | What                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `apps/backend`       | NestJS on Node 24 — the REST API, auth authority, and worker entrypoints                    |
| `apps/console`       | Nuxt 4 web console (Nitro SSR, Vue 3, shadcn-vue) — the UI, served same-origin with the API |
| `apps/cli`           | Bun-compiled single-binary CLI with the Helm chart embedded                                 |
| `apps/docs`          | Astro + Starlight docs site (this repo's public docs)                                       |
| `packages/*`         | Shared source-only packages: `@kubwave/{api-client,crypto,db,kube,templates}`               |
| `infra/helm/kubwave` | The Helm chart — single source of truth for what lands in your cluster                      |

## Local development

See [AGENTS.md](./AGENTS.md) for the full local-dev architecture. TL;DR:

```sh
bun install
bun run dev          # k3d + Tilt — the full local stack (backend API + console + backend worker + db)
bun run --filter=docs dev   # just the docs site, on http://localhost:4321
```

## Community

- [**Documentation**](https://docs.kubwave.com) — user guides, architecture, reference
- [**Contributing guide**](./CONTRIBUTING.md) — dev setup, conventions, PR process
- [**Code of Conduct**](./CODE_OF_CONDUCT.md) — our community standards
- [**Security policy**](./SECURITY.md) — how to report vulnerabilities
- [**GitHub Issues**](https://github.com/kubwave/kubwave/issues) — bugs and feature requests

## License

Licensed under the [Apache License 2.0](./LICENSE).
