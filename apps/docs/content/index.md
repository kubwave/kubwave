---
title: kubwave
description: The open-source, self-hosted PaaS for your apps. Kubernetes-native, single-binary install.
hero:
  tagline: An open-source, self-hosted PaaS for your apps. One binary, any Kubernetes cluster, full control.
  actions:
    - text: Get Started
      link: /start/quickstart/
      icon: right-arrow
      variant: primary
    - text: View on GitHub
      link: https://github.com/kubwave/kubwave
      icon: external
      variant: minimal
---

## Why kubwave?

::card-grid
::card{title="One binary, full stack" icon="rocket"}
Ship a single Bun-compiled CLI that boots a complete Kubernetes-based PaaS — Backend API, Console, Worker, database, ingress — with one command.
::
::card{title="You own the cluster" icon="puzzle"}
Runs on your own infrastructure. Bring-your-own Kubernetes, or use a managed platform like Cloudfleet on Hetzner. [See supported
providers](/start/supported-providers/).
::
::card{title="Open by default" icon="open-book"}
NestJS backend API with generated OpenAPI client, Nuxt console, Helm chart as the single source of truth for everything that lands in your
cluster.
::
::card{title="Built for self-hosters" icon="setting"}
Cert-manager TLS, Traefik routing, Postgres included. Replaceable pieces, not a black box.
::
::

## Where to next?

::card-grid
::card{title="Quickstart" icon="rocket"}
Install the CLI and boot a cluster in 5 minutes. [Start here](/start/quickstart/).
::
::card{title="Introduction" icon="open-book"}
What kubwave is, who it is for, and how it compares. [Read the intro](/start/introduction/).
::
::card{title="Supported providers" icon="puzzle"}
See what works today and what provider targets are coming next. [View providers](/start/supported-providers/).
::
::
