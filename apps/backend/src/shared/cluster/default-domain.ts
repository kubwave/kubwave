import type { CoreV1Api } from '@kubernetes/client-node';
import {
	DEFAULT_DOMAIN_RUNTIME_KEY,
	DEFAULT_DOMAIN_SETTINGS_KEY,
	resolveDefaultDomainRuntime,
	resolveDefaultDomainSettings,
	type DefaultDomainRuntime,
	type DefaultDomainSettings
} from '@kubwave/db';
import { env } from '../config/worker-env.js';
import { errorMessage } from '../worker-common/errors.js';
import { setSetting, getSetting } from '../worker-common/settings.js';

// Persists ingress IP + TLS to `default-domain-runtime` so the API can build hosts/URLs without cluster access (its RBAC can't read Services).

// Only write when the resolved value changes - the tick runs every ~5s.
let lastWritten: string | null = null;

// The LB IP changes ~never once provisioned: poll every tick until the first IP, then re-read once per TTL.
const IP_CACHE_TTL_MS = 60_000;
let cachedIp: string | null = null;
let cachedAt = 0;

async function readIngressIp(coreApi: CoreV1Api): Promise<string | null> {
	try {
		const svc = await coreApi.readNamespacedService({ name: env.ingressControllerService, namespace: env.ingressControllerNamespace });
		const ingress = svc.status?.loadBalancer?.ingress?.[0];
		return ingress?.ip ?? ingress?.hostname ?? null;
	} catch {
		// Service missing / not yet readable - treated as "no IP yet".
		return null;
	}
}

async function resolveIngressIp(coreApi: CoreV1Api): Promise<string | null> {
	if (env.ingressLoadBalancerIp) return env.ingressLoadBalancerIp;
	const now = Date.now();
	if (cachedIp !== null && now - cachedAt < IP_CACHE_TTL_MS) return cachedIp;
	const ip = await readIngressIp(coreApi);
	if (ip !== null) {
		cachedIp = ip;
		cachedAt = now;
		return ip;
	}
	// Pending (cold start) or a transient read failure: keep the last known IP.
	return cachedIp;
}

export async function reconcileDefaultDomainRuntime(coreApi: CoreV1Api): Promise<DefaultDomainRuntime> {
	const ingressIp = await resolveIngressIp(coreApi);
	const runtime: DefaultDomainRuntime = { ingressIp, tls: Boolean(env.ingressClusterIssuer) };

	const serialized = JSON.stringify(runtime);
	if (serialized !== lastWritten) {
		try {
			await setSetting<DefaultDomainRuntime>(DEFAULT_DOMAIN_RUNTIME_KEY, runtime);
			lastWritten = serialized;
		} catch (err) {
			// Non-fatal: lastWritten stays stale, so the write is re-attempted next tick.
			console.warn('[reconcile] failed to persist default-domain runtime (will retry):', errorMessage(err));
		}
	}
	return runtime;
}

// Read per tick since the admin UI can change the default-domain setting at runtime. See @kubwave/db `buildDefaultDomainHost`.
export async function getDefaultDomainSettings(): Promise<DefaultDomainSettings> {
	return resolveDefaultDomainSettings(await getSetting<Partial<DefaultDomainSettings>>(DEFAULT_DOMAIN_SETTINGS_KEY));
}

export async function getDefaultDomainRuntime(): Promise<DefaultDomainRuntime> {
	return resolveDefaultDomainRuntime(await getSetting<Partial<DefaultDomainRuntime>>(DEFAULT_DOMAIN_RUNTIME_KEY));
}
