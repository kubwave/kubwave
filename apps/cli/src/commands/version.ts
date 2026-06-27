import type { Command } from 'commander';
import { getCliVersion, getHelmVersion } from '~/lib/cli-version.js';
import { loadKubeConfig } from '~/lib/k8s.js';
import { readVersionMarker } from '~/lib/version-marker.js';

async function tryReadChannel(inCluster: boolean): Promise<string> {
	try {
		const kc = loadKubeConfig(inCluster);
		const marker = await readVersionMarker(kc);
		if (marker) return `${marker.channel} (from cluster)`;
		return 'unknown (no installation marker)';
	} catch {
		return 'unknown (no cluster connection)';
	}
}

export function registerVersionCommand(parent: Command): void {
	parent
		.command('version')
		.description('Prints CLI, Helm, chart version, and active release channel')
		.option('--in-cluster', 'Use in-cluster kubeconfig', false)
		.action(async (opts: { inCluster: boolean }) => {
			const channel = await tryReadChannel(opts.inCluster);
			console.log(`kubwave CLI  v${getCliVersion()}`);
			console.log(`Helm (embedded)  ${getHelmVersion()}`);
			console.log(`Channel          ${channel}`);
		});
}
