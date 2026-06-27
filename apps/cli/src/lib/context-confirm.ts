import * as p from '@clack/prompts';
import type { KubeConfig } from '@kubernetes/client-node';
import { APP_NAMESPACE } from '~/lib/constants.js';
import { UserCancelledError } from '~/lib/errors.js';
import { getClusterInfo } from '~/lib/k8s.js';

export async function confirmClusterContext(kc: KubeConfig, skipConfirm: boolean, opts: { namespace?: string; action?: string } = {}): Promise<void> {
	const { server, context } = getClusterInfo(kc);
	const namespace = opts.namespace ?? APP_NAMESPACE;
	const action = opts.action ?? 'installation';

	p.log.info(`Cluster-Context: ${context}`);
	p.log.info(`Server:          ${server}`);
	p.log.info(`Namespace:       ${namespace}`);

	if (skipConfirm) {
		p.log.step('Cluster confirmation skipped (--cluster-confirmed)');
		return;
	}

	const confirmed = await p.confirm({
		message: `Proceed with ${action} on this cluster?`
	});

	if (p.isCancel(confirmed) || !confirmed) {
		throw new UserCancelledError(`${action.charAt(0).toUpperCase()}${action.slice(1)} aborted.`);
	}
}
