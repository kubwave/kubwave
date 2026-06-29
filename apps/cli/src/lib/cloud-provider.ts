import type { KubeConfig } from '@kubernetes/client-node';
import { CoreV1Api } from '@kubernetes/client-node';

export type CloudProvider = 'aws' | 'gcp' | 'hetzner';

// CFKE stamps every node with its provider under this label; kubwave reuses it to pin workloads/CSI drivers.
export const CFKE_PROVIDER_LABEL = 'cfke.io/provider';

// Single source for the cfke.io/provider node selector used by descriptors, Traefik values, and the CSI catalog.
export function cfkeNodeSelector(provider: CloudProvider): Record<string, string> {
	return { [CFKE_PROVIDER_LABEL]: provider };
}

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
		const fromLabel = parseCfkeProviderLabel(node.metadata?.labels?.[CFKE_PROVIDER_LABEL]);
		const detected = fromId ?? fromLabel;
		if (detected) {
			counts.set(detected, (counts.get(detected) ?? 0) + 1);
		}
	}
	return counts;
}
