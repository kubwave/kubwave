import type { KubeConfig } from '@kubernetes/client-node';
import { CoreV1Api } from '@kubernetes/client-node';

export type CloudProvider = 'aws' | 'gcp' | 'hetzner';

const PROVIDER_ID_PREFIXES: Record<string, CloudProvider> = {
	aws: 'aws',
	gce: 'gcp',
	hcloud: 'hetzner'
};

const CFKE_LABEL_VALUES: Record<string, CloudProvider> = {
	aws: 'aws',
	gcp: 'gcp',
	google: 'gcp',
	hetzner: 'hetzner',
	hcloud: 'hetzner'
};

export function parseProviderId(providerID: string | undefined | null): CloudProvider | null {
	if (!providerID) return null;
	const match = providerID.match(/^([a-z0-9]+):\/\//i);
	if (!match || !match[1]) return null;
	return PROVIDER_ID_PREFIXES[match[1].toLowerCase()] ?? null;
}

export function parseCfkeProviderLabel(label: string | undefined | null): CloudProvider | null {
	if (!label) return null;
	return CFKE_LABEL_VALUES[label.toLowerCase()] ?? null;
}

export async function detectFleetProviders(kc: KubeConfig): Promise<Map<CloudProvider, number>> {
	const api = kc.makeApiClient(CoreV1Api);
	const nodes = await api.listNode();
	const counts = new Map<CloudProvider, number>();
	for (const node of nodes.items) {
		const fromId = parseProviderId(node.spec?.providerID);
		const fromLabel = parseCfkeProviderLabel(node.metadata?.labels?.['cfke.io/provider']);
		const detected = fromId ?? fromLabel;
		if (detected) {
			counts.set(detected, (counts.get(detected) ?? 0) + 1);
		}
	}
	return counts;
}
