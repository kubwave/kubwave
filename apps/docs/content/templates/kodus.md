---
title: Kodus
description: A self-hosted Kodus stack — an AI code reviewer that subscribes to your Git provider's webhooks and posts inline LLM review suggestions on pull requests. Bring your own LLM key.
---

This template brings up a self-hosted [Kodus](https://kodus.io) stack — an open-source AI code reviewer.
It subscribes to your Git provider's webhooks, builds an AST graph of the repository, and posts inline
LLM-generated review suggestions on pull requests. One click instantiates seven wired-up services. You
**bring your own LLM key** and configure it in Kodus's own settings after install — the template ships no
model credentials.

## What you get

| Service         | Image                            | Role                                                                               |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `web` (primary) | `kodus-ai-web`                   | The dashboard and public entrypoint (gets the web domain).                         |
| `api`           | `kodus-ai-api`                   | REST API + auth; runs the database migrations on boot.                             |
| `worker`        | `kodus-ai-worker`                | Runs the review pipeline and the in-process AST parser.                            |
| `webhooks`      | `kodus-ai-webhook`               | Receives inbound Git-provider webhooks (gets the webhook domain).                  |
| `postgres`      | `pgvector/pgvector:pg16`         | Postgres with the `vector` extension for embeddings.                               |
| `mongodb`       | `mongo:8`                        | Document store.                                                                    |
| `rabbitmq`      | `kodus-rabbitmq` (Kodus's build) | Message broker (delayed-exchange plugin + `kodus-ai`/`kodus-ast` vhosts baked in). |

## Inputs

Kodus needs **two** public hosts — the webhook receiver serves `/github/webhook` at its path root and
can't live under a subpath of the dashboard:

- **`web_domain`** (required) — the dashboard, e.g. `kodus.example.com`.
- **`webhook_domain`** (required) — where your Git provider sends webhooks, e.g.
  `kodus-webhooks.example.com`.

Point DNS at **both** hosts. A missing webhook URL makes Kodus silently skip webhook registration —
repos connect, but reviews never fire — which is why both are required.

## Generated secrets

You don't type any passwords. The template generates them per instance and wires them across the
services: database passwords (`pg_password`, `mongo_password`, `rabbitmq_password`), the JWT signing keys
(`jwt_secret`, `jwt_refresh_secret`, `nextauth_secret`), a webhook token, and two **hex** keys —
`crypto_key` (`API_CRYPTO_KEY`) and `code_management_secret` (`CODE_MANAGEMENT_SECRET`). The last two are
64-character hex strings because Kodus hex-decodes them; a random password there would silently break
Kodus's at-rest encryption.

## Deploying — order matters

The platform creates the seven services but does **not** deploy them for you, and there are no init
containers or dependency ordering. **Only the `api` runs database migrations** (concurrent migrators race
on `CREATE TYPE` and crash-loop the first boot), so deploy in this order:

1. **`postgres`, `mongodb`, `rabbitmq`** — the datastores. Wait for all three to be ready.
2. **`api`** — it migrates and seeds the databases, then serves. Wait for it to finish migrating.
3. **`worker`** — it declares the job queues on first connect.
4. **`webhooks`**.
5. **`web`** — the dashboard.

A dependent started early just crash-loops until its dependency is up; the rollout gate tolerates this
for a few minutes, and the app waits on the broker rather than crashing. Still, deploying in order avoids
noise. The `api` completing its migration is the gate that makes everything downstream useful.

## After install

### 1. Configure an LLM provider (BYOK)

The template ships **no** model key. Open the dashboard at `https://<web_domain>` and add your own
provider key in Kodus's settings — Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint.
Nothing reviews until a provider is configured.

### 2. Register your Git provider

For GitHub, create a GitHub App and point it at your hosts:

- **Callback URL** — `https://<web_domain>/api/auth/callback/github`
- **Setup URL** — `https://<web_domain>/setup/github`
- **Webhook URL** — `https://<webhook_domain>/github/webhook`

GitLab, Bitbucket and Azure Repos follow the same pattern — the template pre-wires each provider's webhook
URL to `https://<webhook_domain>/<provider>/webhook`.

## Sizing

The `worker` runs the AST parser in-process (`SANDBOX_PROVIDER=local`), so it carries the most headroom —
a 2Gi limit. That's enough for repositories up to roughly **100k lines of code**; larger repos need a
higher `worker` memory limit, or switching Kodus to a remote sandbox (`SANDBOX_PROVIDER=e2b`, which needs
an E2B key). The whole stack requests ~3.1Gi and is in line with Kodus's documented 8GB minimum.

::callout{type="note"}
The Kodus app images (`kodus-ai-*`) are **`linux/amd64` only** — they won't schedule on an arm64 node.
::

## Licensing & telemetry

- Kodus is **AGPL-3.0**, with the `ee/` and `*.ee.*` paths under a separate commercial licence. The
  base template deploys only the AGPL core (no Enterprise services).
- Upstream sends an anonymous daily telemetry heartbeat. To opt out, add
  `KODUS_TELEMETRY_DISABLED=true` to the `api`, `worker` and `webhooks` services' environment.
