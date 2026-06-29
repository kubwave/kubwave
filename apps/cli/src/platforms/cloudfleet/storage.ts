import type { KubeConfig, V1Secret, V1StorageClass } from '@kubernetes/client-node';
import { CoreV1Api, StorageV1Api } from '@kubernetes/client-node';
import * as p from '@clack/prompts';
import type { StorageDecision, StorageOpts } from '~/lib/platforms.js';
import { detectFleetProviders, type CloudProvider } from '~/lib/cloud-provider.js';
import { helmRepoAddAndInstall } from '~/lib/dependencies.js';
import { applyManifest } from '~/lib/k8s-apply.js';
import { FatalCliError, UserCancelledError } from '~/lib/errors.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';
import { CSI_CATALOG, type CsiDefinition, type CsiPrerequisite, type StorageClassSpec } from './csi-catalog.js';

const DEFAULT_SC_ANNOTATION = 'storageclass.kubernetes.io/is-default-class';

export type CloudfleetStoragePlan =
	| { action: 'use-storage-class'; storageClass: string; decision: StorageDecision }
	| { action: 'skip'; decision: StorageDecision }
	| { action: 'use-default'; storageClass: string; decision: StorageDecision }
	| {
			action: 'install-csi';
			provider: CloudProvider;
			nodeCount: number;
			csi: CsiDefinition;
			decision: StorageDecision;
			prerequisiteBootstrap?: CsiPrerequisiteBootstrap;
	  };

type CsiPrerequisiteBootstrap = {
	prerequisite: CsiPrerequisite;
	source: NonNullable<CsiPrerequisite['bootstrapFrom']>;
	targetKey: string;
};

export function makeCloudfleetStorage(provider: CloudProvider): (kc: KubeConfig, opts: StorageOpts) => Promise<StorageDecision> {
	return async (kc, opts) => {
		const plan = await planCloudfleetStorage(kc, provider, opts);

		if (plan.action === 'use-storage-class') {
			p.log.info(`StorageClass set by flag: ${plan.storageClass}`);
			return plan.decision;
		}
		if (plan.action === 'skip') {
			p.log.info('Storage check skipped (--storage=skip).');
			return plan.decision;
		}
		if (plan.action === 'use-default') {
			p.log.success(`Default StorageClass: ${plan.storageClass} (no CSI install needed)`);
			return plan.decision;
		}

		const { nodeCount, csi } = plan;
		p.log.warn('Default StorageClass: not found');
		p.log.info(`Platform provider: ${plan.provider} (${nodeCount} matching ${nodeCount === 1 ? 'node' : 'nodes'})`);
		p.log.info(`Recommendation: ${csi.label}`);
		p.log.info(`  -> Install:       ${csi.install.kind === 'helm' ? csi.install.chart : `manifest (${csi.install.driverVersion})`}`);
		p.log.info(`  -> StorageClass:  ${csi.storageClass}`);
		p.log.info(`  -> NodeSelector:  ${formatNodeSelector(csi.nodeSelector)}`);

		if (csi.info) {
			p.log.warn(csi.info);
		}
		if (csi.prerequisite) {
			if (plan.prerequisiteBootstrap) {
				const source = plan.prerequisiteBootstrap.source;
				p.log.info(
					`  -> Prerequisite:  will create Secret ${csi.prerequisite.namespace}/${csi.prerequisite.name} from ${source.namespace}/${source.name} key ${source.key}`
				);
			} else {
				const key = csi.prerequisite.key ? ` key ${csi.prerequisite.key}` : '';
				p.log.success(`  -> Prerequisite:  Secret ${csi.prerequisite.namespace}/${csi.prerequisite.name}${key} (present)`);
			}
		}

		await confirmStorageInstall(csi);

		if (plan.prerequisiteBootstrap) {
			const spinner = p.spinner();
			const prereq = plan.prerequisiteBootstrap.prerequisite;
			spinner.start(`Preparing Secret ${prereq.namespace}/${prereq.name}...`);
			try {
				const changed = await bootstrapCsiPrerequisite(kc, plan.prerequisiteBootstrap);
				spinner.stop(changed ? `Secret ${prereq.namespace}/${prereq.name} ready.` : `Secret ${prereq.namespace}/${prereq.name} already ready.`);
			} catch (err) {
				spinner.stop('Prerequisite preparation failed.');
				throw err;
			}
		}

		const spinner = p.spinner();
		spinner.start(`Installing ${csi.label}...`);
		try {
			const install = csi.install;
			switch (install.kind) {
				case 'helm':
					await helmRepoAddAndInstall(install.repo, install.chart, install.release, install.namespace, install.extraArgs);
					break;
				case 'manifest': {
					const applied = await applyManifest(kc, install.manifest);
					p.log.info(`Applied ${applied} ${csi.label} objects (server-side apply).`);
					break;
				}
				default:
					install satisfies never;
					throw new Error(`Unsupported CSI install kind: ${(install as { kind: string }).kind}`);
			}
			spinner.stop(`${csi.label} installed.`);
		} catch (err) {
			spinner.stop('Installation failed.');
			throw err;
		}

		if (csi.createStorageClass) {
			const sc = csi.createStorageClass;
			spinner.start(`Ensuring StorageClass ${sc.name}...`);
			try {
				const created = await ensureStorageClass(kc, sc);
				spinner.stop(created ? `StorageClass ${sc.name} created.` : `StorageClass ${sc.name} already exists.`);
			} catch (err) {
				spinner.stop('StorageClass creation failed.');
				throw err;
			}
		}

		return plan.decision;
	};
}

export async function planCloudfleetStorage(kc: KubeConfig, provider: CloudProvider, opts: StorageOpts): Promise<CloudfleetStoragePlan> {
	if (opts.storageClass) {
		return { action: 'use-storage-class', storageClass: opts.storageClass, decision: { storageClass: opts.storageClass } };
	}
	if (opts.storageMode === 'skip') {
		return { action: 'skip', decision: {} };
	}

	const defaultSc = await findDefaultStorageClass(kc);
	if (defaultSc) {
		return { action: 'use-default', storageClass: defaultSc, decision: {} };
	}

	// `provider` is already chosen — inspect the cluster only to warn on no matching nodes, never abort.
	const providers = await detectFleetProviders(kc);
	const nodeCount = providers.get(provider) ?? 0;
	if (nodeCount === 0) {
		const seen = providers.size > 0 ? ` (detected: ${[...providers.keys()].join(', ')})` : '';
		p.log.warn(
			`No nodes with cfke.io/provider=${provider} were found${seen}. Continuing with your platform choice, but the CSI install may stay Pending until matching nodes appear.`
		);
	}

	const csi = CSI_CATALOG[provider];
	let prerequisiteBootstrap: CsiPrerequisiteBootstrap | undefined;

	if (csi.prerequisite) {
		prerequisiteBootstrap = await planPrerequisiteBootstrap(kc, csi.prerequisite);
	}

	return {
		action: 'install-csi',
		provider,
		nodeCount,
		csi,
		decision: {
			storageClass: csi.storageClass,
			nodeSelector: csi.nodeSelector
		},
		...(prerequisiteBootstrap ? { prerequisiteBootstrap } : {})
	};
}

export async function confirmStorageInstall(csi: CsiDefinition): Promise<void> {
	const confirmed = await p.confirm({
		message: `Install ${csi.label} in ${csi.install.namespace}?`
	});
	if (p.isCancel(confirmed)) {
		throw new UserCancelledError('CSI installation cancelled.');
	}
	if (!confirmed) {
		throw new FatalCliError('CSI installation declined. Pass --storage-class=<name> or --storage=skip as an alternative.');
	}
}

async function findDefaultStorageClass(kc: KubeConfig): Promise<string | null> {
	const api = kc.makeApiClient(StorageV1Api);
	try {
		const list = await api.listStorageClass();
		for (const sc of list.items) {
			const isDefault = sc.metadata?.annotations?.[DEFAULT_SC_ANNOTATION] === 'true';
			if (isDefault && sc.metadata?.name) {
				return sc.metadata.name;
			}
		}
	} catch {
		// no permission or API error → caller treats as "no default"
	}
	return null;
}

async function planPrerequisiteBootstrap(kc: KubeConfig, prereq: CsiPrerequisite): Promise<CsiPrerequisiteBootstrap | undefined> {
	const api = kc.makeApiClient(CoreV1Api);
	const current = await readSecretOrNull(api, prereq.namespace, prereq.name);
	const hasRequiredKey = prereq.key ? Boolean(current?.data?.[prereq.key]) : current !== null;
	if (hasRequiredKey) return undefined;

	if (prereq.bootstrapFrom) {
		const source = await readSecretOrNull(api, prereq.bootstrapFrom.namespace, prereq.bootstrapFrom.name);
		if (source?.data?.[prereq.bootstrapFrom.key]) {
			return {
				prerequisite: prereq,
				source: prereq.bootstrapFrom,
				targetKey: prereq.bootstrapFrom.targetKey ?? prereq.key ?? prereq.bootstrapFrom.key
			};
		}
	}

	const missing = prereq.key ? `Secret ${prereq.namespace}/${prereq.name} key ${prereq.key}` : `Secret ${prereq.namespace}/${prereq.name}`;
	throw new FatalCliError(`Missing prerequisite: ${missing} not found.\n${prereq.hint}`);
}

async function readSecretOrNull(api: CoreV1Api, namespace: string, name: string): Promise<V1Secret | null> {
	try {
		return await api.readNamespacedSecret({ namespace, name });
	} catch (err) {
		if (isNotFoundError(err)) return null;
		throw err;
	}
}

async function bootstrapCsiPrerequisite(kc: KubeConfig, bootstrap: CsiPrerequisiteBootstrap): Promise<boolean> {
	const api = kc.makeApiClient(CoreV1Api);
	const source = await readSecretOrNull(api, bootstrap.source.namespace, bootstrap.source.name);
	const encodedValue = source?.data?.[bootstrap.source.key];
	if (!encodedValue) {
		throw new FatalCliError(
			`Missing prerequisite: Secret ${bootstrap.source.namespace}/${bootstrap.source.name} key ${bootstrap.source.key} not found.\n${bootstrap.prerequisite.hint}`
		);
	}

	const current = await readSecretOrNull(api, bootstrap.prerequisite.namespace, bootstrap.prerequisite.name);
	if (current?.data?.[bootstrap.targetKey] === encodedValue) return false;

	const body: V1Secret = {
		metadata: {
			name: bootstrap.prerequisite.name,
			namespace: bootstrap.prerequisite.namespace,
			...(current?.metadata?.labels ? { labels: current.metadata.labels } : {}),
			...(current?.metadata?.annotations ? { annotations: current.metadata.annotations } : {}),
			...(current?.metadata?.resourceVersion ? { resourceVersion: current.metadata.resourceVersion } : {})
		},
		type: current?.type ?? 'Opaque',
		data: {
			...current?.data,
			[bootstrap.targetKey]: encodedValue
		}
	};

	if (current) {
		await api.replaceNamespacedSecret({ namespace: bootstrap.prerequisite.namespace, name: bootstrap.prerequisite.name, body });
		return true;
	}

	await api.createNamespacedSecret({ namespace: bootstrap.prerequisite.namespace, body });
	return true;
}

export async function ensureStorageClass(kc: KubeConfig, spec: StorageClassSpec): Promise<boolean> {
	const api = kc.makeApiClient(StorageV1Api);
	try {
		await api.readStorageClass({ name: spec.name });
		return false;
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}

	const body: V1StorageClass = {
		apiVersion: 'storage.k8s.io/v1',
		kind: 'StorageClass',
		metadata: { name: spec.name },
		provisioner: spec.provisioner,
		...(spec.parameters ? { parameters: spec.parameters } : {}),
		...(spec.reclaimPolicy ? { reclaimPolicy: spec.reclaimPolicy } : {}),
		...(spec.volumeBindingMode ? { volumeBindingMode: spec.volumeBindingMode } : {}),
		...(spec.allowVolumeExpansion !== undefined ? { allowVolumeExpansion: spec.allowVolumeExpansion } : {})
	};
	await api.createStorageClass({ body });
	return true;
}

function formatNodeSelector(ns: Record<string, string>): string {
	return Object.entries(ns)
		.map(([k, v]) => `${k}=${v}`)
		.join(', ');
}
