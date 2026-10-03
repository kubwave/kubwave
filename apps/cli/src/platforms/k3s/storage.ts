import { CoreV1Api, StorageV1Api, type KubeConfig, type V1StorageClass } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { StorageDecision, StorageOpts } from '~/lib/platforms.js';
import { FatalCliError } from '~/lib/errors.js';

const DEFAULT_SC_ANNOTATION = 'storageclass.kubernetes.io/is-default-class';
export const K3S_LOCAL_PATH_PROVISIONER = 'rancher.io/local-path';

// k3s ships local-path as the default class; any other default (Longhorn, a cloud CSI) was chosen by the operator, so use it as-is.
export async function ensureK3sStorage(kc: KubeConfig, opts: StorageOpts): Promise<StorageDecision> {
	if (opts.storageClass) {
		p.log.info(`StorageClass set by flag: ${opts.storageClass}`);
		return { storageClass: opts.storageClass };
	}
	if (opts.storageMode === 'skip') {
		p.log.info('Storage check skipped (--storage=skip).');
		return {};
	}

	const storageClass = await findDefaultStorageClass(kc);
	const name = storageClass?.metadata?.name;
	if (!name) {
		throw new FatalCliError(
			'No default StorageClass found. k3s ships `local-path` as the default unless it was started with --disable=local-storage — re-enable it, install a CSI driver (e.g. Longhorn), or pass --storage-class <name>.'
		);
	}

	p.log.success(`Default StorageClass: ${name}`);
	if (storageClass.allowVolumeExpansion !== true) {
		p.log.info(`"${name}" does not allow volume expansion, so kubwave's volume autoscaling leaves its volumes at their initial size.`);
	}
	if (storageClass.provisioner === K3S_LOCAL_PATH_PROVISIONER && (await countNodes(kc)) > 1) {
		p.log.warn(
			`"${name}" stores each volume on one node's disk: the platform database, the image registry and tenant volumes stay pinned to that node and are lost with it. On a multi-node cluster prefer a replicated StorageClass (e.g. Longhorn) via --storage-class.`
		);
	}
	return { storageClass: name };
}

async function findDefaultStorageClass(kc: KubeConfig): Promise<V1StorageClass | undefined> {
	const list = await kc.makeApiClient(StorageV1Api).listStorageClass();
	return list.items.find(sc => sc.metadata?.annotations?.[DEFAULT_SC_ANNOTATION] === 'true');
}

async function countNodes(kc: KubeConfig): Promise<number> {
	const nodes = await kc.makeApiClient(CoreV1Api).listNode();
	return nodes.items.length;
}
