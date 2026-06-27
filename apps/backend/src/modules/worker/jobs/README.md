# Worker jobs

`src/modules/worker/jobs` contains every recurring worker domain and the code
that makes that domain idempotent. The worker stays controller-style: each tick
observes current state, applies the smallest needed change, and can safely retry.
Do not introduce a queue as the default control flow unless the job truly needs
durable per-item work outside this reconciliation model.

## File roles

- `job.ts` is the scheduled entrypoint for a domain. Keep it focused on tick
  orchestration, step ordering, and fault isolation.
- `claim.ts` owns database claiming/locking for a domain.
- `reconcile.ts` owns batch scans and dispatch into per-row or per-resource
  workflows.
- `workflow/` contains small state-machine steps for one claimed item.
- `deployers/` contains service-type specific deployment logic and shared
  runtime helpers.
- `logs.ts`, `types.ts`, `registry.ts`, and similarly named files should stay
  narrow and local to their domain.

## Imports

- Within one job domain, prefer relative imports such as `./claim.js` or
  `./workflow/reconcile-one.js`.
- Across job domains, use relative `.js` imports. The backend build emits Node
  ESM and must not rely on Bun-only path aliases.
- Shared runtime infrastructure lives under `src/shared`, for example
  `shared/cluster`, `shared/config/worker-env.ts`, and `shared/worker-common`.
