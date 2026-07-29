import type { KubeConfig } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { StorageDecision, StorageOpts } from '~/lib/platforms.js';
import { FatalCliError } from '~/lib/errors.js';
import { storageClassExists } from '~/lib/k8s.js';

export const UPCLOUD_DEFAULT_STORAGE_CLASS = 'upcloud-block-storage-maxiops';

export async function ensureUpcloudStorage(kc: KubeConfig, opts: StorageOpts): Promise<StorageDecision> {
	if (opts.storageClass) {
		p.log.info(`StorageClass set by flag: ${opts.storageClass}`);
		return { storageClass: opts.storageClass };
	}
	if (opts.storageMode === 'skip') {
		p.log.info('Storage check skipped (--storage=skip).');
		return {};
	}

	const present = await storageClassExists(kc, UPCLOUD_DEFAULT_STORAGE_CLASS);
	if (present) {
		p.log.success(`UKS StorageClass: ${UPCLOUD_DEFAULT_STORAGE_CLASS}`);
		return { storageClass: UPCLOUD_DEFAULT_STORAGE_CLASS };
	}

	throw new FatalCliError(
		`StorageClass "${UPCLOUD_DEFAULT_STORAGE_CLASS}" not found. UKS ships this StorageClass pre-installed — verify you are on UpCloud Managed Kubernetes and the CSI driver (storage.csi.upcloud.com) is running.`
	);
}
