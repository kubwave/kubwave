import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, parseAllDocuments } from 'yaml';
import { generateValuesFile } from '../src/lib/helm.js';

interface K8sObject {
	kind?: string;
	metadata?: {
		name?: string;
		annotations?: Record<string, string>;
	};
	data?: Record<string, string>;
	spec?: Record<string, unknown>;
}

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const chartPath = join(repoRoot, 'infra', 'helm', 'kubwave');
const cloudfleetValuesPath = join(chartPath, 'values-cloudfleet-hetzner.yaml');
const chartDefaultValues = parse(readFileSync(join(chartPath, 'values.yaml'), 'utf8')) as Record<string, unknown>;

// Assert against values.yaml (the real contract), not a literal, so a version bump survives but a broken value path still fails.
const builds = chartDefaultValues['builds'] as Record<string, unknown> | undefined;
const postgresImage = (chartDefaultValues['postgres'] as { image?: Record<string, unknown> } | undefined)?.image;

function chartValue(value: unknown, label: string): string {
	expect(typeof value === 'string' && value.length > 0, `values.yaml is missing a non-empty ${label}`).toBe(true);

	return value as string;
}

const buildEngine = chartValue(builds?.['engine'], 'builds.engine');
const builderImage = chartValue(builds?.['builderImage'], 'builds.builderImage');
const buildToolsImage = chartValue(builds?.['buildToolsImage'], 'builds.buildToolsImage');
const postgresImageName = `${chartValue(postgresImage?.['repository'], 'postgres.image.repository')}:${chartValue(postgresImage?.['tag'], 'postgres.image.tag')}`;

const productionOverrides = [
	'-f',
	cloudfleetValuesPath,
	'--set',
	'api.image.repository=ghcr.io/acme/backend',
	'--set',
	'api.image.tag=0.2.0',
	'--set',
	'console.image.repository=ghcr.io/acme/console',
	'--set',
	'console.image.tag=0.2.0',
	'--set',
	'worker.image.repository=ghcr.io/acme/backend',
	'--set',
	'worker.image.tag=0.2.0',
	'--set',
	'builds.buildToolsImage=ghcr.io/acme/build-tools:0.2.0',
	'--set',
	'ingress.host=app.example.com',
	'--set',
	'api.env.APP_BASE_URL=https://app.example.com',
	'--set',
	'certManager.clusterIssuer.email=ops@example.com'
];

const optionalTopLevelValues = [
	{
		key: 'adminer',
		resources: [
			{ kind: 'Service', name: 'adminer' },
			{ kind: 'Deployment', name: 'adminer' },
			{ kind: 'Ingress', name: 'adminer' }
		]
	},
	{
		key: 'docs',
		resources: [
			{ kind: 'Service', name: 'docs' },
			{ kind: 'Deployment', name: 'docs' },
			{ kind: 'Ingress', name: 'docs' }
		]
	},
	{
		key: 'mailcrab',
		resources: [
			{ kind: 'Service', name: 'mailcrab' },
			{ kind: 'Deployment', name: 'mailcrab' },
			{ kind: 'Ingress', name: 'mailcrab' }
		]
	},
	{
		key: 'registry',
		resources: [
			{ kind: 'Service', name: 'kubwave-registry' },
			{ kind: 'Deployment', name: 'kubwave-registry' },
			{ kind: 'PersistentVolumeClaim', name: 'kubwave-registry-data' },
			{ kind: 'Ingress', name: 'kubwave-registry' },
			{ kind: 'DaemonSet', name: 'kubwave-registry-containerd-trust' }
		]
	},
	{
		// ha is a toggle, not a component, but its enabled field makes the tracker discover it; when absent the chart must still render with NO PDBs.
		key: 'ha',
		resources: [
			{ kind: 'PodDisruptionBudget', name: 'api' },
			{ kind: 'PodDisruptionBudget', name: 'console' }
		]
	}
];

describe('helm chart rendering', () => {
	test('tracks every optional top-level enabled value', () => {
		const discovered = Object.entries(chartDefaultValues)
			.filter(([, value]) => isRecord(value) && Object.hasOwn(value, 'enabled'))
			.map(([key]) => key)
			.sort();
		const tracked = optionalTopLevelValues.map(value => value.key).sort();

		expect(tracked).toEqual(discovered);
	});

	for (const optionalValue of optionalTopLevelValues) {
		test(`renders when ${optionalValue.key} is missing from old release values`, () => {
			const objects = renderObjects(['--set-json', `${optionalValue.key}=null`]);

			for (const resource of optionalValue.resources) {
				expect(hasObject(objects, resource.kind, resource.name), `${optionalValue.key} should not render ${resource.kind}/${resource.name}`).toBe(
					false
				);
			}
		}, 15000);
	}

	test('configures node containerd trust for the in-cluster HTTP registry', () => {
		const endpoint = 'kubwave-registry.kubwave.svc.cluster.local:5000';
		const objects = renderObjects([
			'--set',
			'registry.enabled=true',
			'--set',
			`builds.registry.endpoint=${endpoint}`,
			'--set',
			'builds.registry.insecure=true'
		]);

		const ds = objects.find(obj => obj.kind === 'DaemonSet' && obj.metadata?.name === 'kubwave-registry-containerd-trust') as
			| {
					spec?: {
						template?: {
							spec?: {
								containers?: Array<{
									securityContext?: { privileged?: boolean };
									env?: Array<{ name?: string; value?: string }>;
								}>;
								volumes?: Array<{ hostPath?: { path?: string } }>;
							};
						};
					};
			  }
			| undefined;
		expect(ds).toBeDefined();
		const container = ds?.spec?.template?.spec?.containers?.[0];
		// Privileged + hostPath: the only way to teach the node's containerd to trust HTTP.
		expect(container?.securityContext?.privileged).toBe(true);
		expect(container?.env?.find(envVar => envVar.name === 'REGISTRY_ENDPOINT')?.value).toBe(endpoint);
		expect(ds?.spec?.template?.spec?.volumes?.[0]?.hostPath?.path).toBe('/etc/containerd/certs.d');
	});

	test('omits the containerd-trust DaemonSet for a TLS (non-insecure) registry', () => {
		const objects = renderObjects(['--set', 'registry.enabled=true', '--set', 'builds.registry.insecure=false']);
		expect(hasObject(objects, 'DaemonSet', 'kubwave-registry-containerd-trust')).toBe(false);
	});

	test('production render keeps mailcrab disabled and clears the dev SMTP host', () => {
		const objects = renderObjects(productionOverrides);

		expect(objects.some(obj => obj.metadata?.name === 'mailcrab')).toBe(false);
		expect(deploymentEnv(objects, 'api', 'SMTP_HOST')).toBe('');
	});

	test('production render creates the ClusterIssuer for a fresh install', () => {
		const objects = renderObjects(productionOverrides);
		const issuer = objects.find(obj => obj.kind === 'ClusterIssuer' && obj.metadata?.name === 'letsencrypt-prod') as
			| { spec?: { acme?: { email?: string } } }
			| undefined;

		expect(issuer?.spec?.acme?.email).toBe('ops@example.com');
	});

	test('CLI prod values can reuse an existing ClusterIssuer without rendering it', () => {
		const config = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '0.2.0',
			imageRegistry: 'ghcr.io/acme',
			namespace: 'kubwave',
			ha: false,
			certManagerClusterIssuer: { name: 'letsencrypt-prod', create: false }
		};
		const objects = renderObjects(['-f', generateValuesFile(config)]);
		const consoleIngress = objects.find(obj => obj.kind === 'Ingress' && obj.metadata?.name === 'console');

		expect(hasObject(objects, 'ClusterIssuer', 'letsencrypt-prod')).toBe(false);
		expect(consoleIngress?.metadata?.annotations?.['cert-manager.io/cluster-issuer']).toBe('letsencrypt-prod');
	});

	test('in-cluster update job renders dependency repair containers and CLI upgrade phase', () => {
		const objects = renderObjects(productionOverrides);
		const template = objects.find(obj => obj.kind === 'ConfigMap' && obj.metadata?.name === 'update-job-template');
		expect(template).toBeDefined();

		const job = parse(template?.data?.['job.yaml'] ?? '') as {
			spec?: {
				template?: {
					spec?: {
						initContainers?: Array<{ name?: string; command?: string[]; args?: string[]; volumeMounts?: Array<{ name?: string }> }>;
						volumes?: Array<{ name?: string }>;
					};
				};
			};
		};
		const initContainers = job.spec?.template?.spec?.initContainers ?? [];
		expect(initContainers.map(container => container.name)).toEqual([
			'prepare',
			'repair-dependencies',
			'wait-dependencies',
			'helm-plan',
			'helm-upgrade'
		]);

		const repair = initContainers.find(container => container.name === 'repair-dependencies');
		expect(repair?.args).toContain('--phase=repair-dependencies');
		expect(template?.data).not.toHaveProperty('traefik-values.yaml');
		expect(job.spec?.template?.spec?.volumes?.map(volume => volume.name)).not.toContain('update-config');
		expect(repair?.volumeMounts?.map(volume => volume.name)).not.toContain('update-config');

		const waitDependencies = initContainers.find(container => container.name === 'wait-dependencies');
		expect(waitDependencies?.args).toContain('--phase=wait-dependencies');

		// The bun phase only plans (resolves state + writes the values file).
		const plan = initContainers.find(container => container.name === 'helm-plan');
		const planArgs = plan?.args ?? [];
		expect(planArgs).toContain('update');
		expect(planArgs).toContain('--in-cluster');
		expect(planArgs).toContain('--phase=helm-plan');
		expect(planArgs).toContain('--target={{TARGET_VERSION}}');
		expect(planArgs).toContain('--run-id={{RUN_ID}}');

		// The actual upgrade runs helm as PID 1 (no Bun.spawn) with fully static args.
		const helm = initContainers.find(container => container.name === 'helm-upgrade');
		expect(helm?.command).toEqual(['/usr/local/bin/helm']);
		const helmArgs = helm?.args ?? [];
		expect(helmArgs).toContain('upgrade');
		expect(helmArgs).toContain('--install');
		expect(helmArgs).toContain('/tmp/work/chart.tgz');
		expect(helmArgs).toContain('/tmp/work/upgrade-values.yaml');
		expect(helmArgs).toContain('--reset-then-reuse-values');
		expect(helmArgs).not.toContain('update');

		expect(template?.data?.['job.yaml']).not.toContain('{{TARGET_REGISTRY}}');
		expect(template?.data?.['job.yaml']).not.toContain('--set');
		expect(template?.data?.['job.yaml']).not.toContain('{{`');
	});

	test('update RBAC can manage app resources and dependency releases', () => {
		const objects = renderObjects(productionOverrides);
		const role = objects.find(obj => obj.kind === 'Role' && obj.metadata?.name === 'kubwave-updater') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;
		const appClusterRole = objects.find(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-updater-app') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;
		const appClusterRoleBinding = objects.find(obj => obj.kind === 'ClusterRoleBinding' && obj.metadata?.name === 'kubwave-updater-app');
		const clusterRole = objects.find(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-updater-dependencies') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;
		const clusterRoleBinding = objects.find(obj => obj.kind === 'ClusterRoleBinding' && obj.metadata?.name === 'kubwave-updater-dependencies');

		expect(hasRule(role, '', 'serviceaccounts', 'create')).toBe(true);
		expect(hasRule(role, '', 'persistentvolumeclaims', 'create')).toBe(true);
		expect(hasRule(role, 'apps', 'replicasets', 'list')).toBe(true);
		// The chart ships a DaemonSet, so the self-update SA must manage daemonsets or `helm upgrade` is forbidden.
		expect(hasRule(role, 'apps', 'daemonsets', 'create')).toBe(true);
		// HA PDBs + the CNPG Cluster CR are chart-shipped, so self-update must apply (and roll back) both.
		expect(hasRule(role, 'policy', 'poddisruptionbudgets', 'create')).toBe(true);
		expect(hasRule(role, 'postgresql.cnpg.io', 'clusters', 'create')).toBe(true);
		expect(hasRule(role, 'networking.k8s.io', 'networkpolicies', 'get')).toBe(true);
		expect(hasRule(role, 'networking.k8s.io', 'networkpolicies', 'create')).toBe(true);
		expect(hasRule(role, 'rbac.authorization.k8s.io', 'rolebindings', 'bind')).toBe(true);
		expect(hasRule(role, 'traefik.io', 'middlewares', 'create')).toBe(true);
		expect(hasRule(appClusterRole, '', 'namespaces', 'get')).toBe(true);
		expect(hasRule(appClusterRole, '', 'namespaces', 'patch')).toBe(true);
		expect(hasRule(appClusterRole, 'cert-manager.io', 'clusterissuers', 'patch')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterroles', 'get')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterroles', 'escalate')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterrolebindings', 'patch')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterrolebindings', 'bind')).toBe(true);
		expect(appClusterRoleBinding).toBeDefined();
		expect(hasRule(clusterRole, 'apiextensions.k8s.io', 'customresourcedefinitions', 'create')).toBe(true);
		expect(hasRule(clusterRole, 'networking.k8s.io', 'ingressclasses', 'create')).toBe(true);
		expect(hasRule(clusterRole, 'cert-manager.io', 'clusterissuers', 'create')).toBe(true);
		expect(hasRule(clusterRole, 'rbac.authorization.k8s.io', 'clusterrolebindings', 'bind')).toBe(true);
		expect(clusterRoleBinding).toBeDefined();
	});

	test('update RBAC grants app cluster resources when dependency repair is disabled', () => {
		const objects = renderObjects([
			'--set',
			'update.serviceAccount.create=true',
			'--set',
			'worker.serviceAccount.create=true',
			'--set',
			'certManager.clusterIssuer.create=true',
			'--set',
			'certManager.clusterIssuer.email=ops@example.com'
		]);
		const appClusterRole = objects.find(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-updater-app') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;

		expect(appClusterRole).toBeDefined();
		expect(objects.some(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-updater-dependencies')).toBe(false);

		expect(hasRule(appClusterRole, '', 'namespaces', 'get')).toBe(true);
		expect(hasRule(appClusterRole, 'cert-manager.io', 'clusterissuers', 'get')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterroles', 'get')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterroles', 'escalate')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterrolebindings', 'patch')).toBe(true);
		expect(hasRule(appClusterRole, 'rbac.authorization.k8s.io', 'clusterrolebindings', 'bind')).toBe(true);
	});

	test('worker can manage tenant ingresses and is wired with the provider ingress config', () => {
		const objects = renderObjects(productionOverrides);

		// Tenant namespaces are per-environment, provisioned on demand, so the worker's workloads RBAC is a cluster-scoped ClusterRole, not a namespaced Role.
		const workloadsRole = objects.find(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-worker-workloads') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;

		expect(workloadsRole).toBeDefined();
		expect(hasRule(workloadsRole, 'networking.k8s.io', 'ingresses', 'create')).toBe(true);
		expect(hasRule(workloadsRole, 'networking.k8s.io', 'ingresses', 'delete')).toBe(true);
		expect(hasRule(workloadsRole, 'networking.k8s.io', 'networkpolicies', 'create')).toBe(true);
		expect(hasRule(workloadsRole, '', 'namespaces', 'create')).toBe(true);
		expect(hasRule(workloadsRole, '', 'namespaces', 'delete')).toBe(true);
		// And there must be NO namespaced workloads Role left behind.
		expect(objects.some(obj => obj.kind === 'Role' && obj.metadata?.name === 'kubwave-worker-workloads')).toBe(false);

		// The worker writes the managed-Prometheus ConfigMap in the platform namespace.
		const workerRole = objects.find(obj => obj.kind === 'Role' && obj.metadata?.name === 'kubwave-worker') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;

		expect(hasRule(workerRole, '', 'configmaps', 'create')).toBe(true);

		// HA reconciler: scale the CNPG Cluster + mirror ha_enabled into the platform marker.
		expect(hasRule(workerRole, 'postgresql.cnpg.io', 'clusters', 'update')).toBe(true);

		const cmUpdate = (workerRole?.rules ?? []).find(
			rule => (rule.resources ?? []).includes('configmaps') && (rule.verbs ?? []).includes('update')
		) as { resourceNames?: string[] } | undefined;

		expect(cmUpdate?.resourceNames).toContain('kubwave-platform');

		// Prod (cloudfleet-hetzner) routes tenant domains through Traefik + cert-manager.
		expect(deploymentEnv(objects, 'worker', 'INGRESS_CLASS_NAME')).toBe('traefik');
		expect(deploymentEnv(objects, 'worker', 'INGRESS_CLUSTER_ISSUER')).toBe('letsencrypt-prod');
		expect(deploymentEnv(objects, 'worker', 'INGRESS_ANNOTATIONS')).toBe('{}');
		expect(deploymentEnv(objects, 'worker', 'DNS_POD_LABELS')).toBe('{"k8s-app":"coredns"}');
		expect(deploymentEnv(objects, 'worker', 'DNS_SERVICE_IP')).toBe('10.96.0.10/32');
	});

	test('production builder NetworkPolicy allows Cloudfleet CoreDNS and Traefik registry ingress path', () => {
		const objects = renderObjects(productionOverrides);
		const policy = objects.find(obj => obj.kind === 'NetworkPolicy' && obj.metadata?.name === 'kubwave-builder-egress') as
			| {
					spec?: {
						egress?: Array<{
							to?: Array<Record<string, unknown>>;
							ports?: Array<{ port?: number; protocol?: string }>;
						}>;
					};
			  }
			| undefined;
		const egress = policy?.spec?.egress ?? [];

		expect(policy).toBeDefined();
		expect(egress[0]?.to).toEqual([
			{
				namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
				podSelector: { matchLabels: { 'k8s-app': 'coredns' } }
			},
			{ ipBlock: { cidr: '10.96.0.10/32' } }
		]);
		expect(egress).toContainEqual({
			to: [
				{
					namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'traefik' } },
					podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } }
				}
			],
			ports: [
				{ protocol: 'TCP', port: 80 },
				{ protocol: 'TCP', port: 443 },
				{ protocol: 'TCP', port: 8000 },
				{ protocol: 'TCP', port: 8443 }
			]
		});
	});

	test('worker RBAC covers the volume autoscaler (kubelet stats, storage classes, events)', () => {
		const objects = renderObjects(productionOverrides);
		const clusterRole = objects.find(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-worker-workloads') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;
		const role = objects.find(obj => obj.kind === 'Role' && obj.metadata?.name === 'kubwave-worker') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;

		expect(hasRule(clusterRole, '', 'nodes/proxy', 'get')).toBe(true);
		expect(hasRule(clusterRole, 'storage.k8s.io', 'storageclasses', 'get')).toBe(true);
		expect(hasRule(role, '', 'events', 'create')).toBe(true);

		// The autoscaler reuses existing grants for the writes themselves:
		expect(hasRule(clusterRole, '', 'persistentvolumeclaims', 'update')).toBe(true);
		expect(hasRule(role, 'postgresql.cnpg.io', 'clusters', 'update')).toBe(true);
	});

	test('api workloads RBAC is a read-only ClusterRole (no namespaced Role, no mutate verbs)', () => {
		const objects = renderObjects(productionOverrides);
		const apiWorkloads = objects.find(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-api-workloads') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;

		expect(apiWorkloads).toBeDefined();
		expect(hasRule(apiWorkloads, 'apps', 'deployments', 'get')).toBe(true);
		expect(hasRule(apiWorkloads, 'apps', 'deployments', 'create')).toBe(false);
		expect(hasRule(apiWorkloads, '', 'namespaces', 'create')).toBe(false);

		// Live service metrics read the kubelet Summary API through the apiserver node proxy.
		expect(hasRule(apiWorkloads, '', 'nodes/proxy', 'get')).toBe(true);

		// The Logs tab tails tenant container logs cluster-wide.
		expect(hasRule(apiWorkloads, '', 'pods/log', 'get')).toBe(true);
		expect(objects.some(obj => obj.kind === 'Role' && obj.metadata?.name === 'kubwave-api-workloads')).toBe(false);
	});

	test('api control-plane RBAC can only read the platform marker ConfigMap', () => {
		const objects = renderObjects(productionOverrides);
		const apiRole = objects.find(obj => obj.kind === 'Role' && obj.metadata?.name === 'kubwave-api') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; resourceNames?: string[]; verbs?: string[] }> }
			| undefined;
		const configMapRead = (apiRole?.rules ?? []).find(
			rule => (rule.apiGroups ?? []).includes('') && (rule.resources ?? []).includes('configmaps') && (rule.verbs ?? []).includes('get')
		);

		expect(configMapRead?.resourceNames).toEqual(['kubwave-platform']);
		expect(hasRule(apiRole, '', 'configmaps', 'list')).toBe(false);
		expect(hasRule(apiRole, '', 'configmaps', 'update')).toBe(false);
	});

	test('static Prometheus RBAC renders for the managed metrics provider (worker provisions the workload at runtime)', () => {
		const objects = renderObjects(productionOverrides);
		const sa = objects.find(obj => obj.kind === 'ServiceAccount' && obj.metadata?.name === 'kubwave-prometheus');
		const clusterRole = objects.find(obj => obj.kind === 'ClusterRole' && obj.metadata?.name === 'kubwave-prometheus') as
			| { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> }
			| undefined;
		const binding = objects.find(obj => obj.kind === 'ClusterRoleBinding' && obj.metadata?.name === 'kubwave-prometheus');

		expect(sa).toBeDefined();
		expect(binding).toBeDefined();

		// Prometheus scrapes the kubelet via the apiserver node proxy.
		expect(hasRule(clusterRole, '', 'nodes/proxy', 'get')).toBe(true);
		expect(hasRule(clusterRole, '', 'nodes', 'list')).toBe(true);

		// The workload itself is NOT in the chart — the worker creates it on demand.
		expect(objects.some(obj => obj.kind === 'Deployment' && obj.metadata?.name === 'kubwave-prometheus')).toBe(false);
	});

	test('no static workloads namespace is rendered (namespaces are per-environment, runtime-provisioned)', () => {
		const objects = renderObjects(productionOverrides);
		expect(objects.some(obj => obj.kind === 'Namespace' && obj.metadata?.name === 'kubwave-apps')).toBe(false);
	});

	test('dev defaults leave tenant ingress class/issuer empty and point at kube-system controller', () => {
		const objects = renderObjects([]);
		expect(deploymentEnv(objects, 'worker', 'INGRESS_CLASS_NAME')).toBe('');
		expect(deploymentEnv(objects, 'worker', 'INGRESS_CLUSTER_ISSUER')).toBe('');
		expect(deploymentEnv(objects, 'worker', 'INGRESS_ANNOTATIONS')).toBe('{}');
		expect(deploymentEnv(objects, 'worker', 'INGRESS_CONTROLLER_NAMESPACE')).toBe('kube-system');
	});

	test('dev platform marker seeds registry metadata without enabling TLS', () => {
		const objects = renderObjects([]);
		const marker = objects.find(obj => obj.kind === 'ConfigMap' && obj.metadata?.name === 'kubwave-platform');
		const dependencies = parse(marker?.data?.dependencies_json ?? '{}') as { traefik?: { namespace?: string; ingressClassName?: string } };

		expect(marker?.data?.domain).toBe('console.localhost');
		expect(marker?.data?.registry_mode).toBe('external');
		expect(marker?.data?.registry_host).toBe('host.k3d.internal:5111');
		expect(marker?.data?.registry_insecure).toBe('true');
		expect(marker?.data?.registry_ingress_enabled).toBe('false');
		expect(marker?.data?.registry_cluster_issuer).toBeUndefined();
		expect(marker?.data?.registry_ingress_class_name).toBeUndefined();
		expect(dependencies.traefik?.namespace).toBe('kube-system');
		expect(dependencies.traefik?.ingressClassName).toBe('');
	});

	test('worker is wired with the build images from chart defaults', () => {
		const objects = renderObjects([]);
		// Source builds need the build-tools image plumbed into the worker alongside BuildKit; assert against values.yaml, not a literal.
		expect(deploymentEnv(objects, 'worker', 'BUILD_ENGINE')).toBe(buildEngine);
		expect(deploymentEnv(objects, 'worker', 'BUILDER_IMAGE')).toBe(builderImage);
		expect(deploymentEnv(objects, 'worker', 'BUILD_TOOLS_IMAGE')).toBe(buildToolsImage);
		expect(deploymentEnv(objects, 'worker', 'BUILD_IMAGE_PULL_SECRETS')).toBe('');
	});

	test('production worker exposes image pull secrets to generated build Jobs', () => {
		const objects = renderObjects(productionOverrides);
		expect(deploymentEnv(objects, 'worker', 'BUILD_IMAGE_PULL_SECRETS')).toBe('regcred');
	});

	test('CLI-generated install values render the three workloads with prod images', () => {
		const config = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '0.2.0',
			imageRegistry: 'ghcr.io/acme',
			namespace: 'kubwave',
			ha: false
		};
		const valuesFile = generateValuesFile(config);
		const objects = renderObjects(['-f', valuesFile]);

		// Guards against an install path that only sets console.image, leaving api/worker on dev defaults.
		expect(deploymentImage(objects, 'api')).toBe('ghcr.io/acme/backend:0.2.0');
		expect(deploymentImage(objects, 'console')).toBe('ghcr.io/acme/console:0.2.0');
		expect(deploymentImage(objects, 'worker')).toBe('ghcr.io/acme/backend:0.2.0');
		expect(deploymentEnv(objects, 'worker', 'BUILD_TOOLS_IMAGE')).toBe('ghcr.io/acme/build-tools:0.2.0');
		expect(deploymentResources(objects, 'console')).toEqual({
			requests: { cpu: '100m', memory: '256Mi' },
			limits: { cpu: '1000m', memory: '1Gi' }
		});

		// Same bug for tenant ingress: omitting workloadIngress leaves tenant domains on dev defaults (HTTP, no class).
		expect(deploymentEnv(objects, 'worker', 'INGRESS_CLASS_NAME')).toBe('traefik');
		expect(deploymentEnv(objects, 'worker', 'INGRESS_CLUSTER_ISSUER')).toBe('letsencrypt-prod');
		// Same for the sslip base: the chart's `127.0.0.1` default resolves to localhost and breaks HTTP-01.
		expect(deploymentEnv(objects, 'worker', 'INGRESS_LB_IP')).toBe('');

		// JWT lives with the api now, sourced from the pre-created console-creds Secret.
		const api = objects.find(obj => obj.kind === 'Deployment' && obj.metadata?.name === 'api') as
			| {
					spec?: {
						template?: {
							spec?: { containers?: Array<{ name?: string; env?: Array<{ name?: string; valueFrom?: { secretKeyRef?: { name?: string } } }> }> };
						};
					};
			  }
			| undefined;
		const jwt = api?.spec?.template?.spec?.containers?.find(c => c.name === 'api')?.env?.find(e => e.name === 'JWT_SECRET');
		expect(jwt?.valueFrom?.secretKeyRef?.name).toBe('console-creds');

		// Flat same-origin ingress on the configured host; prod disables mailcrab.
		const ingress = objects.find(obj => obj.kind === 'Ingress' && obj.metadata?.name === 'console') as
			| { spec?: { rules?: Array<{ host?: string }> } }
			| undefined;
		expect(ingress?.spec?.rules?.[0]?.host).toBe('app.example.com');
		expect(objects.some(obj => obj.metadata?.name === 'mailcrab')).toBe(false);

		const template = objects.find(obj => obj.kind === 'ConfigMap' && obj.metadata?.name === 'update-job-template');
		expect(template?.data?.['job.yaml']).not.toContain('nodeSelector.cfke\\\\.io/provider=hetzner');
	});

	// Whole-manifest invariant so a new dev-only component can't slip through the way docs did (forgotten → docs:dev/pullPolicy:Never → --wait timeout).
	test('CLI prod values leave no workload on a chart dev default', () => {
		const config = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '0.2.0',
			imageRegistry: 'ghcr.io/acme',
			namespace: 'kubwave',
			ha: false
		};
		const objects = renderObjects(['-f', generateValuesFile(config)]);

		// Dev-only workloads (docs/adminer/mailcrab ship no prod image); prod must disable all three, so none may render a Deployment.
		for (const devOnly of ['docs', 'adminer', 'mailcrab']) {
			expect(hasObject(objects, 'Deployment', devOnly), `prod must not render the dev-only ${devOnly} Deployment`).toBe(false);
		}

		// No rendered container may inherit a chart dev default (tag 'dev'/pullPolicy 'Never') — either means a forgotten override that ErrImageNeverPulls on a cluster.
		expect(deploymentEnv(objects, 'worker', 'BUILD_TOOLS_IMAGE')).not.toBe(buildToolsImage);
		for (const { workload, image, pullPolicy } of allContainerImages(objects)) {
			expect(image.endsWith(':dev'), `${workload} renders dev image ${image}`).toBe(false);
			expect(pullPolicy, `${workload} renders pullPolicy: Never`).not.toBe('Never');
		}
	});

	// SECRETS_KEY encrypts user-service secrets at rest; api and worker must source it from the same console-creds Secret (dev default ships it, prod randomizes).
	test('SECRETS_KEY is wired into both the api and worker from console-creds', () => {
		const objects = renderObjects(productionOverrides);
		for (const name of ['api', 'worker']) {
			const dep = objects.find(obj => obj.kind === 'Deployment' && obj.metadata?.name === name) as
				| {
						spec?: {
							template?: {
								spec?: {
									containers?: Array<{
										name?: string;
										env?: Array<{ name?: string; valueFrom?: { secretKeyRef?: { name?: string; key?: string } } }>;
									}>;
								};
							};
						};
				  }
				| undefined;
			const ref = dep?.spec?.template?.spec?.containers?.find(c => c.name === name)?.env?.find(e => e.name === 'SECRETS_KEY');
			expect(ref?.valueFrom?.secretKeyRef).toEqual({ name: 'console-creds', key: 'SECRETS_KEY' });
		}
	});

	test('the dev-default console-creds Secret ships a SECRETS_KEY', () => {
		// No cloudfleet values → api.secret.create stays true, so the chart renders the Secret.
		const objects = renderObjects([
			'--set',
			'api.image.repository=ghcr.io/acme/backend',
			'--set',
			'api.image.tag=0.2.0',
			'--set',
			'console.image.repository=ghcr.io/acme/console',
			'--set',
			'console.image.tag=0.2.0',
			'--set',
			'worker.image.repository=ghcr.io/acme/backend',
			'--set',
			'worker.image.tag=0.2.0'
		]);
		const secret = objects.find(obj => obj.kind === 'Secret' && obj.metadata?.name === 'console-creds') as
			| { stringData?: Record<string, string> }
			| undefined;
		expect(secret?.stringData?.['SECRETS_KEY']).toBeDefined();
		expect(secret?.stringData?.['JWT_SECRET']).toBeDefined();
	});
});

describe('high availability + CloudNativePG', () => {
	test('defaults render a CloudNativePG Cluster (instances 1), not the legacy StatefulSet', () => {
		const objects = renderObjects([]);
		const cluster = clusterSpec(objects);
		expect(cluster).toBeDefined();
		expect(cluster?.instances).toBe(1);
		expect(cluster?.imageName).toBe(postgresImageName);
		expect(cluster?.bootstrap?.initdb).toEqual({ database: 'kubwave', owner: 'app', secret: { name: 'postgres-app-creds' } });
		expect(cluster?.affinity?.enablePodAntiAffinity).toBe(false);
		// The hand-rolled StatefulSet / `postgres` Service / data PVC must NOT render in cnpg mode.
		expect(hasObject(objects, 'StatefulSet', 'postgres')).toBe(false);
		expect(hasObject(objects, 'Service', 'postgres')).toBe(false);
		expect(hasObject(objects, 'PersistentVolumeClaim', 'postgres-data')).toBe(false);
	});

	test('postgres.mode=statefulset renders the legacy StatefulSet and no Cluster', () => {
		const objects = renderObjects(['--set', 'postgres.mode=statefulset']);
		expect(hasObject(objects, 'StatefulSet', 'postgres')).toBe(true);
		expect(hasObject(objects, 'Service', 'postgres')).toBe(true);
		expect(hasObject(objects, 'PersistentVolumeClaim', 'postgres-data')).toBe(true);
		expect(objects.some(obj => obj.kind === 'Cluster')).toBe(false);
		// The CNPG bootstrap secret only exists in cnpg mode.
		expect(hasObject(objects, 'Secret', 'postgres-app-creds')).toBe(false);
	});

	test('HA on scales api/console to 3 with soft spread and a PDB each, but keeps worker at 1', () => {
		const objects = renderObjects(['--set', 'ha.enabled=true']);
		for (const name of ['api', 'console']) {
			expect(replicasOf(objects, name)).toBe(3);
			const spec = podTemplateSpec(objects, name);
			const term = spec?.affinity?.podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution?.[0];
			expect(term?.podAffinityTerm?.topologyKey).toBe('kubernetes.io/hostname');
			expect(term?.podAffinityTerm?.labelSelector?.matchLabels?.['app.kubernetes.io/name']).toBe(name);
			// Soft spread: a cluster with <3 nodes still schedules every replica.
			expect(spec?.topologySpreadConstraints?.[0]?.whenUnsatisfiable).toBe('ScheduleAnyway');
			const pdb = objects.find(obj => obj.kind === 'PodDisruptionBudget' && obj.metadata?.name === name) as
				| { spec?: { maxUnavailable?: number; minAvailable?: number } }
				| undefined;
			expect(pdb).toBeDefined();
			// maxUnavailable (not minAvailable) keeps >=2 of 3 up and won't deadlock node drains if later scaled to 1 (HA off before the upgrade removes the PDB).
			expect(pdb?.spec?.maxUnavailable).toBe(1);
			expect(pdb?.spec?.minAvailable).toBeUndefined();
		}
		// The worker is a singleton reconcile loop (no leader election), so it must NOT scale with HA or it triples non-idempotent work; stays at 1, no spread, no PDB.
		expect(replicasOf(objects, 'worker')).toBe(1);
		expect(podTemplateSpec(objects, 'worker')?.affinity).toBeUndefined();
		expect(podTemplateSpec(objects, 'worker')?.topologySpreadConstraints).toBeUndefined();
		expect(hasObject(objects, 'PodDisruptionBudget', 'worker')).toBe(false);
	});

	test('HA on scales the CNPG Cluster to 3 with soft anti-affinity', () => {
		const cluster = clusterSpec(renderObjects(['--set', 'ha.enabled=true']));
		expect(cluster?.instances).toBe(3);
		expect(cluster?.affinity?.enablePodAntiAffinity).toBe(true);
		expect(cluster?.affinity?.podAntiAffinityType).toBe('preferred');
	});

	test('HA off (default) renders single replicas, no affinity, no PDBs, single DB instance', () => {
		const objects = renderObjects([]);
		for (const name of ['api', 'console', 'worker']) {
			expect(replicasOf(objects, name)).toBe(1);
			expect(podTemplateSpec(objects, name)?.affinity).toBeUndefined();
			expect(podTemplateSpec(objects, name)?.topologySpreadConstraints).toBeUndefined();
			expect(hasObject(objects, 'PodDisruptionBudget', name)).toBe(false);
		}
		expect(clusterSpec(objects)?.instances).toBe(1);
	});

	test('HA scheduling constraints are soft (no required / DoNotSchedule anywhere)', () => {
		const rendered = renderRaw(['--set', 'ha.enabled=true']);
		expect(rendered).not.toContain('requiredDuringSchedulingIgnoredDuringExecution');
		expect(rendered).not.toContain('DoNotSchedule');
	});

	test('api, worker, and the in-cluster update Job connect to the CNPG read-write Service', () => {
		// productionOverrides so the update-job-template ConfigMap renders; api/worker POSTGRES_HOST inherits the chart default (postgres-rw).
		const objects = renderObjects(productionOverrides);
		expect(deploymentEnv(objects, 'api', 'POSTGRES_HOST')).toBe('postgres-rw');
		expect(deploymentEnv(objects, 'worker', 'POSTGRES_HOST')).toBe('postgres-rw');

		const template = objects.find(obj => obj.kind === 'ConfigMap' && obj.metadata?.name === 'update-job-template');
		const job = parse(template?.data?.['job.yaml'] ?? '') as {
			spec?: { template?: { spec?: { initContainers?: Array<{ env?: Array<{ name?: string; value?: string }> }> } } };
		};
		const hosts = (job.spec?.template?.spec?.initContainers ?? [])
			.flatMap(container => container.env ?? [])
			.filter(envVar => envVar.name === 'POSTGRES_HOST')
			.map(envVar => envVar.value);
		expect(hosts.length).toBeGreaterThan(0);
		expect(hosts.every(host => host === 'postgres-rw')).toBe(true);
	});

	test('dev cnpg mode renders a basic-auth bootstrap secret whose password matches postgres-creds', () => {
		const objects = renderObjects([]);
		const bootstrap = objects.find(obj => obj.kind === 'Secret' && obj.metadata?.name === 'postgres-app-creds') as
			| { type?: string; stringData?: Record<string, string> }
			| undefined;
		const creds = objects.find(obj => obj.kind === 'Secret' && obj.metadata?.name === 'postgres-creds') as
			| { stringData?: Record<string, string> }
			| undefined;
		expect(bootstrap?.type).toBe('kubernetes.io/basic-auth');
		expect(bootstrap?.stringData?.['username']).toBe('app');
		// Password MUST equal postgres-creds.POSTGRES_PASSWORD so the app authenticates as `app`.
		expect(bootstrap?.stringData?.['password']).toBe(creds?.stringData?.['POSTGRES_PASSWORD']);
	});
});

function renderRaw(extraArgs: string[]): string {
	const proc = Bun.spawnSync(['helm', 'template', 'kubwave', chartPath, '--namespace', 'kubwave', ...extraArgs], {
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const stdout = new TextDecoder().decode(proc.stdout);
	const stderr = new TextDecoder().decode(proc.stderr);

	if (proc.exitCode !== 0) {
		throw new Error(`helm template failed (${proc.exitCode}):\n${stderr}`);
	}

	return stdout;
}

function renderObjects(extraArgs: string[]): K8sObject[] {
	return parseAllDocuments(renderRaw(extraArgs))
		.map(doc => doc.toJSON() as K8sObject | null)
		.filter((doc): doc is K8sObject => Boolean(doc));
}

interface PodTemplateSpec {
	affinity?: {
		podAntiAffinity?: {
			preferredDuringSchedulingIgnoredDuringExecution?: Array<{
				podAffinityTerm?: { topologyKey?: string; labelSelector?: { matchLabels?: Record<string, string> } };
			}>;
		};
	};
	topologySpreadConstraints?: Array<{ whenUnsatisfiable?: string; topologyKey?: string }>;
}

function podTemplateSpec(objects: K8sObject[], name: string): PodTemplateSpec | undefined {
	const deployment = objects.find(obj => obj.kind === 'Deployment' && obj.metadata?.name === name);

	return (deployment?.spec as { template?: { spec?: PodTemplateSpec } } | undefined)?.template?.spec;
}

function replicasOf(objects: K8sObject[], name: string): number | undefined {
	const deployment = objects.find(obj => obj.kind === 'Deployment' && obj.metadata?.name === name);

	return (deployment?.spec as { replicas?: number } | undefined)?.replicas;
}

interface ClusterSpec {
	instances?: number;
	imageName?: string;
	bootstrap?: { initdb?: { database?: string; owner?: string; secret?: { name?: string } } };
	affinity?: { enablePodAntiAffinity?: boolean; podAntiAffinityType?: string };
}

function clusterSpec(objects: K8sObject[]): ClusterSpec | undefined {
	const cluster = objects.find(obj => obj.kind === 'Cluster' && obj.metadata?.name === 'postgres');

	return cluster?.spec as ClusterSpec | undefined;
}

function hasObject(objects: K8sObject[], kind: string, name: string): boolean {
	return objects.some(obj => obj.kind === kind && obj.metadata?.name === name);
}

function hasRule(
	obj: { rules?: Array<{ apiGroups?: string[]; resources?: string[]; verbs?: string[] }> } | undefined,
	apiGroup: string,
	resource: string,
	verb: string
): boolean {
	return (obj?.rules ?? []).some(
		rule => (rule.apiGroups ?? []).includes(apiGroup) && (rule.resources ?? []).includes(resource) && (rule.verbs ?? []).includes(verb)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deploymentEnv(objects: K8sObject[], deploymentName: string, envName: string): string | undefined {
	const deployment = objects.find(obj => obj.kind === 'Deployment' && obj.metadata?.name === deploymentName) as
		| {
				spec?: {
					template?: {
						spec?: {
							containers?: Array<{
								name?: string;
								env?: Array<{ name?: string; value?: string }>;
							}>;
						};
					};
				};
		  }
		| undefined;
	const container = deployment?.spec?.template?.spec?.containers?.find(item => item.name === deploymentName);

	return container?.env?.find(item => item.name === envName)?.value;
}

function deploymentImage(objects: K8sObject[], deploymentName: string): string | undefined {
	const deployment = objects.find(obj => obj.kind === 'Deployment' && obj.metadata?.name === deploymentName) as
		| { spec?: { template?: { spec?: { containers?: Array<{ name?: string; image?: string }> } } } }
		| undefined;

	return deployment?.spec?.template?.spec?.containers?.find(item => item.name === deploymentName)?.image;
}

function deploymentResources(objects: K8sObject[], deploymentName: string): unknown {
	const deployment = objects.find(obj => obj.kind === 'Deployment' && obj.metadata?.name === deploymentName) as
		| { spec?: { template?: { spec?: { containers?: Array<{ name?: string; resources?: unknown }> } } } }
		| undefined;

	return deployment?.spec?.template?.spec?.containers?.find(item => item.name === deploymentName)?.resources;
}

// Every (init)container image + pullPolicy in pod-bearing workloads, to assert none inherited a chart dev default; CNPG Cluster excluded (operator-made pods).
function allContainerImages(objects: K8sObject[]): Array<{ workload: string; image: string; pullPolicy?: string }> {
	const podBearing = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ReplicaSet'];
	const out: Array<{ workload: string; image: string; pullPolicy?: string }> = [];

	for (const obj of objects) {
		if (!obj.kind || !podBearing.includes(obj.kind)) continue;

		const podSpec = (obj.spec as { template?: { spec?: PodSpecLite } } | undefined)?.template?.spec;
		const containers = [...(podSpec?.initContainers ?? []), ...(podSpec?.containers ?? [])];

		for (const container of containers) {
			if (container.image) {
				out.push({
					workload: `${obj.kind}/${obj.metadata?.name ?? '?'}:${container.name ?? '?'}`,
					image: container.image,
					pullPolicy: container.imagePullPolicy
				});
			}
		}
	}

	return out;
}

interface PodSpecLite {
	containers?: Array<{ name?: string; image?: string; imagePullPolicy?: string }>;
	initContainers?: Array<{ name?: string; image?: string; imagePullPolicy?: string }>;
}
