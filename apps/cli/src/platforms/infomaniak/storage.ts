import type { KubeConfig } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { StorageDecision, StorageOpts } from '~/lib/platforms.js';
import { FatalCliError } from '~/lib/errors.js';
import { storageClassExists } from '~/lib/k8s.js';

// PCK ships both Cinder classes. csi-cinder-sc-retain is the cluster default, but a PaaS creates and
// deletes tenant volumes constantly and Retain leaves every one of them billable after the PVC is
// gone — so prefer the Delete variant and only fall back when the cluster lacks it.
export const INFOMANIAK_DEFAULT_STORAGE_CLASS = 'csi-cinder-sc-delete';
export const INFOMANIAK_RETAIN_STORAGE_CLASS = 'csi-cinder-sc-retain';

export async function ensureInfomaniakStorage(kc: KubeConfig, opts: StorageOpts): Promise<StorageDecision> {
	if (opts.storageClass) {
		p.log.info(`StorageClass set by flag: ${opts.storageClass}`);
		return { storageClass: opts.storageClass };
	}
	if (opts.storageMode === 'skip') {
		p.log.info('Storage check skipped (--storage=skip).');
		return {};
	}

	if (await storageClassExists(kc, INFOMANIAK_DEFAULT_STORAGE_CLASS)) {
		p.log.success(`PCK StorageClass: ${INFOMANIAK_DEFAULT_STORAGE_CLASS}`);
		return { storageClass: INFOMANIAK_DEFAULT_STORAGE_CLASS };
	}

	if (await storageClassExists(kc, INFOMANIAK_RETAIN_STORAGE_CLASS)) {
		p.log.warn(
			`StorageClass "${INFOMANIAK_DEFAULT_STORAGE_CLASS}" not found — falling back to "${INFOMANIAK_RETAIN_STORAGE_CLASS}". Its reclaim policy is Retain, so deleting a service leaves its Cinder volume behind and it keeps costing money until you delete it in the Infomaniak console.`
		);
		return { storageClass: INFOMANIAK_RETAIN_STORAGE_CLASS };
	}

	throw new FatalCliError(
		`Neither StorageClass "${INFOMANIAK_DEFAULT_STORAGE_CLASS}" nor "${INFOMANIAK_RETAIN_STORAGE_CLASS}" was found. Infomaniak PCK ships both pre-installed — verify you are on Public Cloud Kubernetes and the Cinder CSI driver (cinder.csi.openstack.org) is running.`
	);
}
