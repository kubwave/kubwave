import type { NewService, Service, ServiceConfig } from '@kubwave/db';
import { rewriteCrossRefs, type RefMapping } from './rewrite.js';

export interface ClonePlanContext {
	previewEnvironmentId: string;
	baseNamespace: string;
	previewNamespace: string;
	prRepoUrl: string;
	prRef: string;
	headSha: string;
	defaultDomainHost?: (service: { serviceId: string; serviceName: string }) => string | null;
	// Injected so the plan is pure/deterministic in tests; production passes crypto.randomUUID.
	newId: () => string;
}

export interface PreviewServiceRow extends NewService {
	id: string;
}

export interface ClonePlan {
	services: PreviewServiceRow[];
}

// Services whose stored repoUrl matches the PR's track the PR ref + auto-deploy; the rest get frozen copies. Monorepo: several services share one repoUrl.
function isPrService(config: ServiceConfig, prRepoUrl: string): boolean {
	return 'repoUrl' in config && (config as { repoUrl: string }).repoUrl === prRepoUrl;
}

function defaultDomainIsActive(config: ServiceConfig): boolean {
	return config.defaultDomainEnabled === true && config.containerPort != null && (config.domains ?? []).length === 0;
}

function buildDefaultDomainMap(base: Service[], previewIdByBase: Map<string, string>, ctx: ClonePlanContext): Map<string, string> {
	const map = new Map<string, string>();
	if (!ctx.defaultDomainHost) return map;

	for (const svc of base) {
		if (!defaultDomainIsActive(svc.config)) continue;
		const previewId = previewIdByBase.get(svc.id);
		if (!previewId) continue;

		const from = ctx.defaultDomainHost({ serviceId: svc.id, serviceName: svc.name });
		const to = ctx.defaultDomainHost({ serviceId: previewId, serviceName: svc.name });
		if (from && to && from !== to) map.set(from, to);
	}

	return map;
}

export function planPreviewServices(base: Service[], ctx: ClonePlanContext): ClonePlan {
	// Pre-generate preview ids so cross-refs (svc-<baseId> -> svc-<previewId>) can be rewritten.
	const idMap = new Map<string, string>(); // base svc-<id> -> preview svc-<id>
	const previewIdByBase = new Map<string, string>();
	for (const svc of base) {
		const previewId = ctx.newId();
		previewIdByBase.set(svc.id, previewId);
		idMap.set(`svc-${svc.id}`, `svc-${previewId}`);
	}
	const mapping: RefMapping = {
		namespace: { from: ctx.baseNamespace, to: ctx.previewNamespace },
		services: idMap,
		defaultDomains: buildDefaultDomainMap(base, previewIdByBase, ctx)
	};

	const services: PreviewServiceRow[] = base.map(svc => {
		const previewId = previewIdByBase.get(svc.id)!;
		const tracksPr = isPrService(svc.config, ctx.prRepoUrl);

		const config = structuredClone(svc.config) as ServiceConfig;
		// env + domains exist on every ServiceConfig member (RuntimeConfig base).
		config.env = (config.env ?? []).map(e => ({ key: e.key, value: rewriteCrossRefs(e.value, mapping) }));
		config.domains = [];
		// branch/commit only exist on repo-backed members; the `'repoUrl' in config` guard narrows to those.
		if ('repoUrl' in config) {
			if (tracksPr) {
				config.branch = ctx.prRef;
				config.commit = ctx.headSha;
			} else {
				// Freeze at the deployed commit; `|| undefined` coerces lastPolledCommit's null (commit?: string rejects null).
				config.commit = config.commit || svc.lastPolledCommit || undefined;
			}
		}

		return {
			id: previewId,
			environmentId: ctx.previewEnvironmentId,
			name: svc.name,
			description: svc.description,
			type: svc.type,
			config,
			autoDeployEnabled: tracksPr,
			// Pin the PR-tracking poll cursor to head so its first git-poll tick is a no-op, not a rebuild of the commit the initial deploy already built.
			lastPolledCommit: tracksPr ? ctx.headSha : null
		};
	});

	return { services };
}

// Rows that get an initial preview deploy: PR-tracking services plus any whose base runs in prod (succeeded). The rest stay un-deployed, mirroring prod.
// base[i] <-> rows[i]: planPreviewServices maps 1:1 in order.
export function deployablePreviewRows(
	base: Service[],
	rows: PreviewServiceRow[],
	deployedBaseIds: Set<string>,
	prRepoUrl: string
): PreviewServiceRow[] {
	return rows.filter((row, i) => {
		const baseSvc = base[i];
		if (!baseSvc) return false;
		const tracksPr = 'repoUrl' in baseSvc.config && (baseSvc.config as { repoUrl: string }).repoUrl === prRepoUrl;
		return tracksPr || deployedBaseIds.has(baseSvc.id);
	});
}
