import type { Command } from 'commander';
import * as p from '@clack/prompts';
import { ApiextensionsV1Api, AppsV1Api, CoreV1Api, RbacAuthorizationV1Api, StorageV1Api, type KubeConfig } from '@kubernetes/client-node';
import { KUBWAVE_PART_OF_SELECTOR, KUBWAVE_COMPONENT_LABEL, KUBWAVE_INSTANCE_LABEL } from '~/lib/constants.js';
import { getClusterInfo, loadKubeConfig } from '~/lib/k8s.js';
import { printAndExit } from '~/lib/errors.js';

export interface AuditedResource {
	kind: string;
	name: string;
	namespace?: string;
	component?: string;
	instance?: string;
}

interface K8sListItem {
	metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
}

export interface AuditReport {
	resources: AuditedResource[];
	// Kinds whose list call failed (e.g. missing RBAC) — surfaced so the report never silently under-reports.
	skipped: string[];
}

export interface AuditOpts {
	inCluster: boolean;
}

const UNLABELLED_GROUP = '(no component)';

export function registerAuditCommand(parent: Command): void {
	parent
		.command('audit')
		.description(`Lists every cluster resource kubwave installed (${KUBWAVE_PART_OF_SELECTOR})`)
		.option('--in-cluster', 'Use in-cluster kubeconfig', false)
		.action(async (opts: AuditOpts) => {
			try {
				await runAudit(opts);
			} catch (err) {
				printAndExit(err);
			}
		});
}

export async function runAudit(opts: AuditOpts): Promise<void> {
	p.intro('kubwave audit');

	const kc = loadKubeConfig(opts.inCluster);
	const { server, context } = getClusterInfo(kc);

	p.log.info(`Cluster-Context: ${context}`);
	p.log.info(`Server:          ${server}`);
	p.log.info(`Selector:        ${KUBWAVE_PART_OF_SELECTOR}`);

	const report = await buildAuditReport(kc);

	if (report.skipped.length > 0) {
		p.log.warn(`Could not list (insufficient permissions?): ${report.skipped.join(', ')}.`);
	}

	if (report.resources.length === 0) {
		p.log.warn('No resources carrying the kubwave ownership label were found.');
		p.outro('Audit complete');
		return;
	}

	const groups = groupByComponent(report.resources);
	for (const [component, items] of groups) {
		const lines = items.map(r => `  ${r.kind} ${r.namespace ? `${r.namespace}/` : ''}${r.name}${r.instance ? ` [${r.instance}]` : ''}`);
		p.log.info(`${component} (${items.length}):\n${lines.join('\n')}`);
	}

	p.log.success(`${report.resources.length} kubwave-owned resource(s) across ${groups.size} component group(s).`);
	p.outro('Audit complete');
}

// Per-kind error isolation: a kind the caller can't list (RBAC) is recorded in `skipped`, not fatal.
export async function buildAuditReport(kc: KubeConfig): Promise<AuditReport> {
	const core = kc.makeApiClient(CoreV1Api);
	const apps = kc.makeApiClient(AppsV1Api);
	const storage = kc.makeApiClient(StorageV1Api);
	const rbac = kc.makeApiClient(RbacAuthorizationV1Api);
	const crds = kc.makeApiClient(ApiextensionsV1Api);
	const labelSelector = KUBWAVE_PART_OF_SELECTOR;

	const queries: Array<{ kind: string; run: () => Promise<{ items: K8sListItem[] }> }> = [
		{ kind: 'Namespace', run: () => core.listNamespace({ labelSelector }) },
		{ kind: 'Deployment', run: () => apps.listDeploymentForAllNamespaces({ labelSelector }) },
		{ kind: 'DaemonSet', run: () => apps.listDaemonSetForAllNamespaces({ labelSelector }) },
		{ kind: 'StatefulSet', run: () => apps.listStatefulSetForAllNamespaces({ labelSelector }) },
		{ kind: 'Service', run: () => core.listServiceForAllNamespaces({ labelSelector }) },
		{ kind: 'ConfigMap', run: () => core.listConfigMapForAllNamespaces({ labelSelector }) },
		{ kind: 'Secret', run: () => core.listSecretForAllNamespaces({ labelSelector }) },
		{ kind: 'StorageClass', run: () => storage.listStorageClass({ labelSelector }) },
		{ kind: 'CSIDriver', run: () => storage.listCSIDriver({ labelSelector }) },
		{ kind: 'ClusterRole', run: () => rbac.listClusterRole({ labelSelector }) },
		{ kind: 'ClusterRoleBinding', run: () => rbac.listClusterRoleBinding({ labelSelector }) },
		{ kind: 'CustomResourceDefinition', run: () => crds.listCustomResourceDefinition({ labelSelector }) }
	];

	const skipped: string[] = [];
	const settled = await Promise.all(
		queries.map(async query => {
			try {
				const result = await query.run();
				return result.items.map(item => toAudited(query.kind, item));
			} catch {
				skipped.push(query.kind);
				return [] as AuditedResource[];
			}
		})
	);

	return { resources: settled.flat(), skipped };
}

function toAudited(kind: string, item: K8sListItem): AuditedResource {
	const labels = item.metadata?.labels ?? {};
	return {
		kind,
		name: item.metadata?.name ?? '<unnamed>',
		...(item.metadata?.namespace ? { namespace: item.metadata.namespace } : {}),
		...(labels[KUBWAVE_COMPONENT_LABEL] ? { component: labels[KUBWAVE_COMPONENT_LABEL] } : {}),
		...(labels[KUBWAVE_INSTANCE_LABEL] ? { instance: labels[KUBWAVE_INSTANCE_LABEL] } : {})
	};
}

// Group by component label; resources without one fall into a single trailing bucket.
export function groupByComponent(resources: AuditedResource[]): Map<string, AuditedResource[]> {
	const groups = new Map<string, AuditedResource[]>();
	for (const resource of resources) {
		const key = resource.component ?? UNLABELLED_GROUP;
		const bucket = groups.get(key);
		if (bucket) bucket.push(resource);
		else groups.set(key, [resource]);
	}
	return groups;
}
