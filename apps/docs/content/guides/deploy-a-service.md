---
title: Deploy a service
description: The five kinds of service — container image, Dockerfile, public repo, private repo, GitHub App — plus docker-compose import and auto-deploy.
---

A **service** is one workload running in an environment. You create it from the console inside a
project's environment, and you can build it from five kinds of source. Every type ends up the same
way: a container image running as a Kubernetes Deployment, behind a Service and (optionally) an
Ingress.

## Service types

::card-grid
::card{title="Container image" icon="rocket"}
A prebuilt image from any registry. Give the platform an **image** and a **tag** — no build happens, it's pulled and run as-is.
::
::card{title="Dockerfile" icon="document"}
A Dockerfile you paste into the console. The platform builds it in-cluster with **BuildKit** and pushes the result to the internal registry. The
build context is just the Dockerfile, so it must be self-contained (a `FROM` line, no local `COPY` from your machine).
::
::card{title="Public repo" icon="github"}
A public Git repository, built from source. **Nixpacks** auto-detects the stack and generates a Dockerfile for you — or point it at the repo's own
Dockerfile instead.
::
::card{title="Private repo" icon="seti:lock"}
A private Git repository, built exactly like a public repo but cloned over an **SSH deploy key** held by your team.
::
::card{title="GitHub App" icon="github"}
A GitHub repository deployed through a connected **GitHub App** — no SSH keys or tokens to manage. Pick an account and repo from a list, and get
**instant deploys** on push.
::
::

### Building from a Git repo

All three repo-based types — public repo, private repo, and GitHub App — share the same build options:

- **Repository & branch** — the Git URL and a branch (defaults to `main`). Optionally pin a specific
  **commit** so deploys are reproducible, or set a **root directory** to build from a sub-folder of a
  monorepo.
- **Builder** — `nixpacks` (the default) auto-detects your language and produces a Dockerfile, so the
  repo needs no Dockerfile of its own. Switch to `dockerfile` to build the repo's existing
  Dockerfile, optionally at a custom **Dockerfile path**.
- **Build & start commands** — optional overrides when the auto-detected defaults aren't right.

The types differ only in how the clone authenticates: a **public repo** uses an `http(s)` URL and
clones anonymously; a **private repo** uses an SSH URL (`git@host:org/repo.git`) and a **team deploy
key** (add the key under your team's SSH keys, then give the repo read access to its public half); a
**GitHub App** repo clones over a short-lived installation token minted per build — see
[Deploy from GitHub](#deploy-from-github) below.

## Deploy from GitHub

The **GitHub App** type deploys straight from GitHub without SSH keys or personal access tokens.
Setup is a one-time, two-step flow:

1. **Connect the App (admin, once per instance).** In **Admin → Settings → Integrations**, click
   _Connect GitHub_. kubwave walks GitHub's App-manifest flow, which registers a GitHub App owned by
   your instance and hands back its credentials automatically — nothing to copy by hand.
2. **Install it on your repos (team owner).** In **Team settings → GitHub**, install the App on the
   account or organization you want, choosing **all repositories** or a hand-picked set.

Then create a service, choose **GitHub**, and pick an account, repository, and branch. Each build
mints a short-lived **installation access token** to clone — the token never touches the repo URL or
the build logs.

::callout{type="caution" title="Webhooks need a public URL"}
Instant push deploys arrive over a GitHub webhook, which GitHub can only deliver to a **publicly reachable** address. On a `localhost` or
private-network instance the App is created **without** a webhook, and auto-deploy falls back to polling. For the same reason, newly added
repositories won't appear until you either set the installation to **All repositories** or click **Refresh from GitHub** in the repository picker.
::

## Import from docker-compose

To stand up several related services at once, paste a `docker-compose.yml` into the environment's
import flow. Each service in the file becomes its own kubwave service, with its image, ports, and
environment carried over — a quick way to bring an existing compose stack into the platform.

## Auto-deploy

Services that build from a Git repo can opt into **auto-deploy**. The platform periodically polls the
repository, and when the tracked branch gets a new commit it kicks off a fresh build and rollout
automatically — no manual redeploy needed. **GitHub App** services also deploy the moment a push
webhook arrives, so the poll interval isn't the floor on how fast they react.

::callout{type="note"}
Auto-deploy applies to the **public repo**, **private repo**, and **GitHub App** types. GitHub App services deploy **instantly** on push via the App
webhook (with polling as a fallback); the others poll on an interval. Image and Dockerfile services are deployed on demand.
::

## Deployments and rollback

Every deploy — manual or automatic — produces an immutable **deployment**: a snapshot of the service
config and the image it built. Each one keeps its own build and runtime logs, and rolling back is
just re-activating an earlier deployment.
