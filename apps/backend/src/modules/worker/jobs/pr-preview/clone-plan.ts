import { decryptSecret, encryptSecret } from '@kubwave/crypto';
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
	// Preview ids of base-public services that got no preview host (default domain off/unresolved or no container port).
	noPreviewHost: Set<string>;
}

// Services whose stored repoUrl matches the PR's track the PR ref + auto-deploy; the rest get frozen copies. Monorepo: several services share one repoUrl.
function isPrService(config: ServiceConfig, prRepoUrl: string): boolean {
	return 'repoUrl' in config && (config as { repoUrl: string }).repoUrl === prRepoUrl;
}

function defaultDomainIsActive(config: ServiceConfig): boolean {
	return config.defaultDomainEnabled === true && config.containerPort != null && (config.domains ?? []).length === 0;
}

function isPublic(config: ServiceConfig): boolean {
	return (config.domains ?? []).length > 0 || (config.defaultDomainEnabled === true && config.containerPort != null);
}

// Custom domains can't follow into a preview, so every base public host maps to the preview copy's generated default host.
function buildHostMap(
	base: Service[],
	previewIdByBase: Map<string, string>,
	ctx: ClonePlanContext
): { hosts: Map<string, string>; noPreviewHost: Set<string> } {
	const hosts = new Map<string, string>();
	const noPreviewHost = new Set<string>();

	for (const svc of base) {
		if (!isPublic(svc.config)) continue;
		const previewId = previewIdByBase.get(svc.id)!;
		const to = svc.config.containerPort != null ? (ctx.defaultDomainHost?.({ serviceId: previewId, serviceName: svc.name }) ?? null) : null;
		if (!to) {
			noPreviewHost.add(previewId);
			continue;
		}

		const from = (svc.config.domains ?? []).map(d => d.host);
		if (defaultDomainIsActive(svc.config)) {
			const baseDefault = ctx.defaultDomainHost?.({ serviceId: svc.id, serviceName: svc.name });
			if (baseDefault) from.push(baseDefault);
		}
		for (const host of from) if (host !== to) hosts.set(host, to);
	}

	return { hosts, noPreviewHost };
}

// Plaintext only lives in worker memory (it already holds SECRETS_KEY); untouched values keep their original ciphertext.
function rewriteCiphertext(ciphertext: string, mapping: RefMapping): string {
	const plain = decryptSecret(ciphertext);
	const next = rewriteCrossRefs(plain, mapping);
	return next === plain ? ciphertext : encryptSecret(next);
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
	const { hosts, noPreviewHost } = buildHostMap(base, previewIdByBase, ctx);
	const mapping: RefMapping = {
		namespace: { from: ctx.baseNamespace, to: ctx.previewNamespace },
		services: idMap,
		hosts
	};

	const services: PreviewServiceRow[] = base.map(svc => {
		const previewId = previewIdByBase.get(svc.id)!;
		const tracksPr = isPrService(svc.config, ctx.prRepoUrl);

		const config = structuredClone(svc.config) as ServiceConfig;
		// env + domains exist on every ServiceConfig member (RuntimeConfig base).
		config.env = (config.env ?? []).map(e => ({ key: e.key, value: rewriteCrossRefs(e.value, mapping) }));
		if (config.secrets) config.secrets = config.secrets.map(s => ({ key: s.key, value: rewriteCiphertext(s.value, mapping) }));
		if (config.configFiles) config.configFiles = config.configFiles.map(f => ({ path: f.path, content: rewriteCiphertext(f.content, mapping) }));
		// Public in base => public in preview, on the generated default host; internal services stay internal.
		if (isPublic(svc.config)) config.defaultDomainEnabled = true;
		config.domains = [];
		// Previews never inherit public TCP exposures: the pool ports are scarce and the base's routes point at the base's pods.
		delete config.exposedPorts;
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

	return { services, noPreviewHost };
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
