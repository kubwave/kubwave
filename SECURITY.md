# Security Policy

## Supported Versions

Security fixes are backported only to the latest **stable** release line.
Prerelease / preview versions are not supported — upgrade to the latest stable
release to receive fixes.

| Version  | Supported          |
| -------- | ------------------ |
| latest   | :white_check_mark: |
| < latest | :x:                |

The kubwave platform consists of the backend image (used by the API and Worker
Deployments), console image, build-tools image, CLI image, a Helm chart, and a
single-binary CLI installer. A "version" refers to the Git tag (without `v`
prefix) that produced the release — all artifacts for a given release share the
same version.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, send a report to **`security@kubwave.com`**. You should receive an
acknowledgement within 48 hours. If you do not, please follow up — it's possible
the initial message was caught by a spam filter.

### What to include

- A clear description of the vulnerability and its impact
- Steps to reproduce, including the kubwave version and the Kubernetes distribution/version
- Any relevant configuration snippets (redact secrets)
- Whether you believe the vulnerability is already publicly known

### Disclosure timeline

1. You report the vulnerability to `security@kubwave.com`.
2. We acknowledge receipt within 48 hours and assign a point of contact.
3. We investigate and validate the issue, aiming to confirm or decline within 5 business days.
4. We develop and test a fix privately.
5. We release the fix as a patch release and publish a security advisory on GitHub.
6. We credit the reporter in the advisory (unless you prefer to remain anonymous).

**We follow a 90-day responsible disclosure window.** If the vulnerability is not
resolved within 90 days of the initial report, you are free to disclose it publicly.

## Scope

The supported attack surface includes:

- The **API** (NestJS HTTP server, authentication, authorization, OpenAPI endpoints)
- The **Console** (Nuxt/Nitro SSR server, browser-facing UI)
- The **Worker** (reconcile loop, self-update job lifecycle, health endpoint)
- The **CLI** (install, upgrade, status commands, embedded Helm/Helm chart)
- The **Helm chart** (rendered Kubernetes manifests, RBAC, secrets handling)
- **Tenant isolation** boundaries (namespace-level NetworkPolicies, environment scoping)

Out of scope:

- Issues in third-party dependencies that are not specific to how kubwave uses them.
  Please report those to the upstream project.
- Issues that require unrestricted physical access to the host or cluster nodes.
- Denial-of-service attacks that require an existing authenticated admin account.

## Security Advisories

Published advisories are available on the
[GitHub Security Advisories](https://github.com/kubwave/kubwave/security/advisories)
page.
