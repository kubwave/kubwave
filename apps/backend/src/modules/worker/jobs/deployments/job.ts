import { CoreV1Api } from '@kubernetes/client-node';
import { type DefaultDomainSettings } from '@kubwave/db';
import { getKubeConfig } from '@kubwave/kube';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { reapOrphanBuildJobs } from './builds/reaper.js';
import { getDefaultDomainSettings, reconcileDefaultDomainRuntime } from '../../../../shared/cluster/default-domain.js';
import { runSteps } from '../../../../shared/worker-common/steps.js';
import { claimPending } from './claim.js';
import { reconcileInFlight } from './reconcile.js';
import { gcOrphans } from './tenant-gc.js';

export async function runDeploymentReconcile(): Promise<void> {
	const kc = getKubeConfig();
	let defaultDomain: DefaultDomainSettings = { mode: 'off', base: null, subdomainTemplate: null };
	try {
		defaultDomain = await getDefaultDomainSettings();
	} catch (err) {
		console.warn('[reconcile] failed to read default-domain settings (skipping default domains this tick):', errorMessage(err));
	}
	const runtime = await reconcileDefaultDomainRuntime(kc.makeApiClient(CoreV1Api));
	await runSteps('reconcile', [
		{
			name: 'claim',
			run: async () => {
				const claimed = await claimPending();
				if (claimed.length > 0) console.log(`[reconcile] claimed ${claimed.length} pending deployment(s)`);
			}
		},
		{ name: 'reconcile', run: () => reconcileInFlight(kc, defaultDomain, runtime) },
		{ name: 'gc', run: () => gcOrphans(kc) },
		{ name: 'reap-build-jobs', run: () => reapOrphanBuildJobs(kc) }
	]);
}
