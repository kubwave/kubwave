import type { Command } from 'commander';
import * as p from '@clack/prompts';
import { CoreV1Api } from '@kubernetes/client-node';
import { APP_NAMESPACE, PLATFORM_CONFIGMAP_NAME } from '~/lib/constants.js';
import { FatalCliError, printAndExit } from '~/lib/errors.js';
import { loadKubeConfig } from '~/lib/k8s.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';

export function registerStatusCommand(parent: Command): void {
	parent
		.command('status')
		.description('Shows the installed platform status')
		.option('--in-cluster', 'Use in-cluster kubeconfig', false)
		.action(async (opts: { inCluster: boolean }) => {
			try {
				p.intro('kubwave status');

				const kc = loadKubeConfig(opts.inCluster);
				const k8sApi = kc.makeApiClient(CoreV1Api);

				try {
					const cm = await k8sApi.readNamespacedConfigMap({
						name: PLATFORM_CONFIGMAP_NAME,
						namespace: APP_NAMESPACE
					});

					const version = cm.data?.['current_version'] ?? 'unknown';
					const channel = cm.data?.['channel'] ?? 'stable (default)';
					const installedAt = cm.data?.['installed_at'] ?? 'unknown';
					const installedBy = cm.data?.['installed_by'] ?? 'unknown';

					p.log.info(`Version:         ${version}`);
					p.log.info(`Channel:         ${channel}`);
					p.log.info(`Installed at:    ${installedAt}`);
					p.log.info(`Installed by:    ${installedBy}`);
				} catch (err: unknown) {
					if (isNotFoundError(err)) {
						p.log.warn('kubwave is not installed (no version marker found).');
					} else {
						throw new FatalCliError(`Failed to read status: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
					}
				}

				p.outro('Done');
			} catch (err) {
				printAndExit(err);
			}
		});
}
