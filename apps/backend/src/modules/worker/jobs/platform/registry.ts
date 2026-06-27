import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
	AppsV1Api,
	CoreV1Api,
	NetworkingV1Api,
	type KubeConfig,
	type V1ConfigMap,
	type V1Deployment,
	type V1Ingress,
	type V1NetworkPolicy,
	type V1NetworkPolicyEgressRule,
	type V1PersistentVolumeClaim,
	type V1Secret,
	type V1Service
} from '@kubernetes/client-node';
import { eq } from 'drizzle-orm';
import {
	BUILD_REGISTRY_SETTINGS_KEY,
	PLATFORM_CONFIGMAP_NAME,
	REGISTRY_HTPASSWD_SECRET_NAME,
	REGISTRY_PULL_SECRET_NAME,
	REGISTRY_PUSH_SECRET_NAME,
	buildRegistryCredentialHash,
	buildRegistryEndpointHost,
	buildRegistryNetworkPolicyEgressPorts,
	normalizeBuildRegistrySettings,
	platformRegistryHost,
	type BuildRegistrySettings
} from '@kubwave/kube';
import { db, settings } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import {
	createIgnoreConflict,
	deleteIgnoreMissing,
	readConfigMapOrNull,
	readDeploymentOrNull,
	readIngressOrNull,
	readNetworkPolicyOrNull,
	readPVCOrNull,
	readSecretOrNull,
	readServiceOrNull,
	replaceWithRetry
} from '../../../../shared/cluster/ops.js';

const REGISTRY_NAME = 'kubwave-registry';
const BUILDER_NETWORK_POLICY_NAME = 'kubwave-builder-egress';
const REGISTRY_PORT = 5000;
const REGISTRY_PVC_NAME = 'kubwave-registry-data';
const WORKER_DEPLOYMENT_NAME = 'worker';
const WORKER_CONTAINER_NAME = 'worker';
const RETRY_ATTEMPTS = 3;
const PUBLIC_EGRESS_PORTS = [80, 443];
const INGRESS_CONTROLLER_EGRESS_PORTS = [80, 443, 8000, 8443];
const MANAGED_INGRESS_RULE_ANNOTATION = 'kubwave.io/builder-networkpolicy-managed-ingress';
const MANAGED_PUBLIC_PORTS_ANNOTATION = 'kubwave.io/builder-networkpolicy-managed-public-ports';

interface MarkerState {
	currentVersion: string;
	domain?: string;
	storageClass?: string;
	nodeSelector?: Record<string, string>;
	ingressClassName?: string;
	clusterIssuerName?: string;
	registryClusterIssuer?: string;
	registryMode?: string;
	registryHost?: string;
	registryInsecure?: boolean;
	registryIngressEnabled?: boolean;
	registryCredentialHash?: string;
}

interface EffectiveRegistry {
	mode: 'platform' | 'external';
	endpoint: string;
	host: string;
	insecure: boolean;
	pushSecretName: string;
	pullSecretName: string;
	ingressEnabled: boolean;
	clusterIssuer?: string;
}

export function registryDrift(desired: BuildRegistrySettings, marker: MarkerState | null): boolean {
	if (desired.mode === 'unconfigured') return marker?.registryMode !== undefined && marker.registryMode !== 'unconfigured';
	if (!marker) return true;
	if (desired.mode === 'platform') {
		if (!marker.domain) return true;
		return (
			marker.registryMode !== 'platform' || marker.registryHost !== platformRegistryHost(marker.domain) || marker.registryIngressEnabled !== true
		);
	}
	return (
		marker.registryMode !== 'external' ||
		marker.registryHost !== desired.endpoint ||
		marker.registryInsecure !== desired.insecure ||
		marker.registryCredentialHash !== registryCredentialHash(desired)
	);
}

export async function reconcileBuildRegistryApply(kc: KubeConfig): Promise<void> {
	const namespace = env.podNamespace;
	const desired = await readDesiredRegistrySettings();
	const coreApi = kc.makeApiClient(CoreV1Api);
	const appsApi = kc.makeApiClient(AppsV1Api);
	const networkingApi = kc.makeApiClient(NetworkingV1Api);
	const marker = await readMarkerState(coreApi, namespace);
	const markerDrift = registryDrift(desired, marker);

	try {
		if (desired.mode === 'unconfigured') {
			if (!markerDrift && !(await workerRegistryEnvDrift(appsApi, namespace, null))) {
				await ensureBuilderNetworkPolicy(networkingApi, namespace, null, stalePublicRegistryPorts(marker, null));
				return;
			}
			await disablePlatformRegistry(coreApi, appsApi, networkingApi, namespace);
			await ensureBuilderNetworkPolicy(networkingApi, namespace, null, stalePublicRegistryPorts(marker, null));
			await applyWorkerRegistryEnv(appsApi, namespace, null);
			await mirrorRegistryMarker(coreApi, namespace, {
				mode: 'unconfigured',
				host: '',
				insecure: false,
				ingressEnabled: false
			});
			return;
		}

		const effective = effectiveRegistry(desired, marker);
		if (!markerDrift && !(await workerRegistryEnvDrift(appsApi, namespace, effective))) {
			await ensureBuilderNetworkPolicy(networkingApi, namespace, effective, stalePublicRegistryPorts(marker, effective));
			return;
		}
		if (desired.mode === 'external') {
			await ensureExternalRegistrySecret(coreApi, namespace, desired, effective.host);
			await disablePlatformRegistry(coreApi, appsApi, networkingApi, namespace);
		} else {
			await ensurePlatformRegistry(coreApi, appsApi, networkingApi, namespace, marker, effective);
		}

		await ensureBuilderNetworkPolicy(networkingApi, namespace, effective, stalePublicRegistryPorts(marker, effective));
		await applyWorkerRegistryEnv(appsApi, namespace, effective);
		await mirrorRegistryMarker(coreApi, namespace, {
			mode: effective.mode,
			host: effective.endpoint,
			insecure: effective.insecure,
			ingressEnabled: effective.ingressEnabled,
			credentialHash: desired.mode === 'external' ? registryCredentialHash(desired) : undefined,
			clusterIssuer: effective.clusterIssuer
		});
	} catch (err) {
		await mirrorRegistryError(coreApi, namespace, desired, errorMessage(err));
		throw err;
	}
}

async function readDesiredRegistrySettings(): Promise<BuildRegistrySettings> {
	const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, BUILD_REGISTRY_SETTINGS_KEY)).limit(1);
	return normalizeBuildRegistrySettings(row?.value);
}

async function readMarkerState(coreApi: CoreV1Api, namespace: string): Promise<MarkerState | null> {
	const cm = await readConfigMapOrNull(coreApi, namespace, PLATFORM_CONFIGMAP_NAME);
	if (!cm) return null;
	const data = cm.data ?? {};
	return {
		currentVersion: (data['current_version'] ?? env.appVersion).replace(/^v/, ''),
		domain: data['domain'],
		storageClass: data['storage_class'],
		nodeSelector: parseStringRecord(data['node_selector_json']),
		ingressClassName: data['registry_ingress_class_name'] ?? data['ingress_class_name'] ?? parseIngressClassName(data['dependencies_json']),
		clusterIssuerName: data['cluster_issuer_name'],
		registryClusterIssuer: data['registry_cluster_issuer'],
		registryMode: data['registry_mode'],
		registryHost: data['registry_host'],
		registryInsecure: data['registry_insecure'] === 'true',
		registryIngressEnabled: data['registry_ingress_enabled'] === 'true',
		registryCredentialHash: data['registry_credential_hash']
	};
}

function effectiveRegistry(desired: Exclude<BuildRegistrySettings, { mode: 'unconfigured' }>, marker: MarkerState | null): EffectiveRegistry {
	if (desired.mode === 'external') {
		return {
			mode: 'external',
			endpoint: desired.endpoint,
			host: buildRegistryEndpointHost(desired.endpoint),
			insecure: desired.insecure,
			pushSecretName: REGISTRY_PUSH_SECRET_NAME,
			pullSecretName: REGISTRY_PULL_SECRET_NAME,
			ingressEnabled: false
		};
	}

	if (!marker?.domain) {
		throw new Error('Platform registry requires the platform domain in the kubwave-platform marker.');
	}

	const clusterIssuer = marker.registryClusterIssuer ?? marker.clusterIssuerName;
	return {
		mode: 'platform',
		endpoint: platformRegistryHost(marker.domain),
		host: platformRegistryHost(marker.domain),
		insecure: !clusterIssuer,
		pushSecretName: REGISTRY_PUSH_SECRET_NAME,
		pullSecretName: REGISTRY_PULL_SECRET_NAME,
		ingressEnabled: true,
		...(clusterIssuer ? { clusterIssuer } : {})
	};
}

async function ensureExternalRegistrySecret(
	coreApi: CoreV1Api,
	namespace: string,
	desired: Extract<BuildRegistrySettings, { mode: 'external' }>,
	registryHost: string
): Promise<void> {
	if (!desired.passwordCiphertext) throw new Error('External registry password is not configured');
	await upsertDockerConfigSecret(
		coreApi,
		namespace,
		REGISTRY_PUSH_SECRET_NAME,
		registryHost,
		desired.username,
		decryptSecret(desired.passwordCiphertext)
	);
}

async function ensurePlatformRegistry(
	coreApi: CoreV1Api,
	appsApi: AppsV1Api,
	networkingApi: NetworkingV1Api,
	namespace: string,
	marker: MarkerState | null,
	effective: EffectiveRegistry
): Promise<void> {
	await ensurePlatformRegistrySecrets(coreApi, namespace, effective.host);
	await ensureRegistryPVC(coreApi, namespace, marker?.storageClass ?? env.storageClassName);
	await ensureRegistryService(coreApi, namespace);
	await ensureRegistryDeployment(appsApi, namespace, marker?.nodeSelector ?? {});
	await ensureRegistryIngress(networkingApi, namespace, effective, marker?.ingressClassName);
}

async function disablePlatformRegistry(coreApi: CoreV1Api, appsApi: AppsV1Api, networkingApi: NetworkingV1Api, namespace: string): Promise<void> {
	await deleteIgnoreMissing(() => networkingApi.deleteNamespacedIngress({ name: REGISTRY_NAME, namespace }));
	await deleteIgnoreMissing(() => appsApi.deleteNamespacedDeployment({ name: REGISTRY_NAME, namespace, propagationPolicy: 'Background' }));
	await deleteIgnoreMissing(() => coreApi.deleteNamespacedService({ name: REGISTRY_NAME, namespace }));
}

async function ensurePlatformRegistrySecrets(coreApi: CoreV1Api, namespace: string, registryHost: string): Promise<void> {
	const existingHtpasswd = await readSecretOrNull(coreApi, namespace, REGISTRY_HTPASSWD_SECRET_NAME);
	const existingDockerConfig = await readSecretOrNull(coreApi, namespace, REGISTRY_PUSH_SECRET_NAME);
	if (existingHtpasswd && existingDockerConfig) return;

	const username = 'kubwave';
	const recoveredPassword = !existingHtpasswd && existingDockerConfig ? passwordFromDockerConfig(existingDockerConfig) : undefined;
	const password = recoveredPassword ?? randomBytes(24).toString('base64url');
	const bcryptHash = bcrypt.hashSync(password, 10);

	await upsertSecret(coreApi, htpasswdSecret(namespace, username, bcryptHash));
	if (!recoveredPassword) {
		await upsertDockerConfigSecret(coreApi, namespace, REGISTRY_PUSH_SECRET_NAME, registryHost, username, password);
	}
}

async function upsertDockerConfigSecret(
	coreApi: CoreV1Api,
	namespace: string,
	name: string,
	registryHost: string,
	username: string,
	password: string
): Promise<void> {
	const dockerConfigJson = JSON.stringify({
		auths: { [registryHost]: { username, password, auth: Buffer.from(`${username}:${password}`).toString('base64') } }
	});
	await upsertSecret(coreApi, {
		apiVersion: 'v1',
		kind: 'Secret',
		metadata: keepMetadata(name, namespace),
		type: 'kubernetes.io/dockerconfigjson',
		data: { '.dockerconfigjson': Buffer.from(dockerConfigJson).toString('base64') }
	});
}

function htpasswdSecret(namespace: string, username: string, bcryptHash: string): V1Secret {
	return {
		apiVersion: 'v1',
		kind: 'Secret',
		metadata: keepMetadata(REGISTRY_HTPASSWD_SECRET_NAME, namespace),
		type: 'Opaque',
		data: { htpasswd: Buffer.from(`${username}:${bcryptHash}`).toString('base64') }
	};
}

async function upsertSecret(coreApi: CoreV1Api, desired: V1Secret): Promise<void> {
	const name = desired.metadata!.name!;
	const namespace = desired.metadata!.namespace!;
	const existing = await readSecretOrNull(coreApi, namespace, name);
	if (!existing) {
		await createIgnoreConflict(() => coreApi.createNamespacedSecret({ namespace, body: desired }));
		return;
	}
	if (existing.type === desired.type && JSON.stringify(existing.data ?? {}) === JSON.stringify(desired.data ?? {})) return;
	desired.metadata = { ...desired.metadata, resourceVersion: existing.metadata?.resourceVersion };
	await coreApi.replaceNamespacedSecret({ name, namespace, body: desired });
}

async function ensureRegistryPVC(coreApi: CoreV1Api, namespace: string, storageClass: string): Promise<void> {
	if (await readPVCOrNull(coreApi, namespace, REGISTRY_PVC_NAME)) return;
	await createIgnoreConflict(() => coreApi.createNamespacedPersistentVolumeClaim({ namespace, body: registryPVC(namespace, storageClass) }));
}

async function ensureRegistryService(coreApi: CoreV1Api, namespace: string): Promise<void> {
	const desired = registryService(namespace);
	const existing = await readServiceOrNull(coreApi, namespace, REGISTRY_NAME);
	if (!existing) {
		await createIgnoreConflict(() => coreApi.createNamespacedService({ namespace, body: desired }));
		return;
	}

	await replaceWithRetry({
		label: `registry Service ${REGISTRY_NAME}`,
		read: () => readServiceOrNull(coreApi, namespace, REGISTRY_NAME),
		build: () => desired,
		carryOver: (fresh, body) => {
			body.metadata = { ...body.metadata, resourceVersion: fresh.metadata?.resourceVersion };
			body.spec = { ...body.spec, clusterIP: fresh.spec?.clusterIP, clusterIPs: fresh.spec?.clusterIPs, ipFamilies: fresh.spec?.ipFamilies };
			return body;
		},
		replace: body => coreApi.replaceNamespacedService({ name: REGISTRY_NAME, namespace, body }),
		maxAttempts: RETRY_ATTEMPTS
	});
}

async function ensureRegistryDeployment(appsApi: AppsV1Api, namespace: string, nodeSelector: Record<string, string>): Promise<void> {
	const desired = registryDeployment(namespace, nodeSelector);
	const existing = await readDeploymentOrNull(appsApi, namespace, REGISTRY_NAME);
	if (!existing) {
		await createIgnoreConflict(() => appsApi.createNamespacedDeployment({ namespace, body: desired }));
		return;
	}

	await replaceWithRetry({
		label: `registry Deployment ${REGISTRY_NAME}`,
		read: () => readDeploymentOrNull(appsApi, namespace, REGISTRY_NAME),
		build: () => desired,
		carryOver: (fresh, body) => {
			body.metadata = { ...body.metadata, resourceVersion: fresh.metadata?.resourceVersion };
			return body;
		},
		replace: body => appsApi.replaceNamespacedDeployment({ name: REGISTRY_NAME, namespace, body }),
		maxAttempts: RETRY_ATTEMPTS
	});
}

async function ensureRegistryIngress(
	networkingApi: NetworkingV1Api,
	namespace: string,
	effective: EffectiveRegistry,
	ingressClassName: string | undefined
): Promise<void> {
	const desired = registryIngress(namespace, effective, ingressClassName);
	const existing = await readIngressOrNull(networkingApi, namespace, REGISTRY_NAME);
	if (!existing) {
		await createIgnoreConflict(() => networkingApi.createNamespacedIngress({ namespace, body: desired }));
		return;
	}

	await replaceWithRetry({
		label: `registry Ingress ${REGISTRY_NAME}`,
		read: () => readIngressOrNull(networkingApi, namespace, REGISTRY_NAME),
		build: () => desired,
		carryOver: (fresh, body) => {
			body.metadata = { ...body.metadata, resourceVersion: fresh.metadata?.resourceVersion };
			return body;
		},
		replace: body => networkingApi.replaceNamespacedIngress({ name: REGISTRY_NAME, namespace, body }),
		maxAttempts: RETRY_ATTEMPTS
	});
}

async function ensureBuilderNetworkPolicy(
	networkingApi: NetworkingV1Api,
	namespace: string,
	effective: EffectiveRegistry | null,
	stalePublicPorts: number[]
): Promise<void> {
	const existing = await readNetworkPolicyOrNull(networkingApi, namespace, BUILDER_NETWORK_POLICY_NAME);
	if (!existing) return;

	const desired = registryAwareBuilderNetworkPolicy(existing, effective, stalePublicPorts);
	if (networkPolicySpecSignature(existing) === networkPolicySpecSignature(desired)) return;

	await replaceWithRetry({
		label: `builder NetworkPolicy ${BUILDER_NETWORK_POLICY_NAME}`,
		read: () => readNetworkPolicyOrNull(networkingApi, namespace, BUILDER_NETWORK_POLICY_NAME),
		build: () => desired,
		carryOver: (fresh, _body) => {
			const next = registryAwareBuilderNetworkPolicy(fresh, effective, stalePublicPorts);
			next.metadata = { ...next.metadata, resourceVersion: fresh.metadata?.resourceVersion };
			return next;
		},
		replace: body => networkingApi.replaceNamespacedNetworkPolicy({ name: BUILDER_NETWORK_POLICY_NAME, namespace, body }),
		maxAttempts: RETRY_ATTEMPTS
	});
}

async function applyWorkerRegistryEnv(appsApi: AppsV1Api, namespace: string, effective: EffectiveRegistry | null): Promise<void> {
	await replaceWithRetry({
		label: `worker Deployment registry env`,
		read: () => readDeploymentOrNull(appsApi, namespace, WORKER_DEPLOYMENT_NAME),
		build: () => ({}) as V1Deployment,
		carryOver: fresh => {
			const dep = structuredClone(fresh) as V1Deployment;
			const containers = dep.spec?.template?.spec?.containers;
			const container = containers?.find(c => c.name === WORKER_CONTAINER_NAME) ?? containers?.[0];
			if (container) {
				container.env = setEnv(container.env ?? [], [
					{ name: 'REGISTRY_ENDPOINT', value: effective?.endpoint ?? '' },
					{ name: 'REGISTRY_INSECURE', value: String(effective?.insecure ?? false) },
					{ name: 'REGISTRY_PUSH_SECRET_NAME', value: effective?.pushSecretName ?? '' },
					{ name: 'REGISTRY_PULL_SECRET_NAME', value: effective?.pullSecretName ?? '' }
				]);
			}
			return dep;
		},
		replace: body => appsApi.replaceNamespacedDeployment({ name: WORKER_DEPLOYMENT_NAME, namespace, body }),
		maxAttempts: RETRY_ATTEMPTS
	});
}

async function workerRegistryEnvDrift(appsApi: AppsV1Api, namespace: string, effective: EffectiveRegistry | null): Promise<boolean> {
	const dep = await readDeploymentOrNull(appsApi, namespace, WORKER_DEPLOYMENT_NAME);
	const containers = dep?.spec?.template?.spec?.containers;
	const container = containers?.find(c => c.name === WORKER_CONTAINER_NAME) ?? containers?.[0];
	if (!container) return true;
	return !registryEnvMatches(container.env ?? [], effective);
}

export function registryEnvMatches(envVars: Array<{ name: string; value?: string }>, effective: EffectiveRegistry | null): boolean {
	const expected = new Map<string, string>();
	if (effective) {
		expected.set('REGISTRY_ENDPOINT', effective.endpoint);
		expected.set('REGISTRY_INSECURE', String(effective.insecure));
		expected.set('REGISTRY_PUSH_SECRET_NAME', effective.pushSecretName);
		expected.set('REGISTRY_PULL_SECRET_NAME', effective.pullSecretName);
	}

	for (const name of ['REGISTRY_ENDPOINT', 'REGISTRY_INSECURE', 'REGISTRY_PUSH_SECRET_NAME', 'REGISTRY_PULL_SECRET_NAME']) {
		const values = envVars.filter(entry => entry.name === name).map(entry => entry.value ?? '');
		const expectedValue = expected.get(name);
		if (expectedValue === undefined) {
			if (values.length > 0) return false;
		} else if (values.length !== 1 || values[0] !== expectedValue) {
			return false;
		}
	}
	return true;
}

function setEnv(
	envVars: Array<{ name: string; value?: string }>,
	entries: Array<{ name: string; value: string }>
): Array<{ name: string; value?: string }> {
	const names = new Set(entries.map(entry => entry.name));
	const next = envVars.filter(entry => !names.has(entry.name));
	for (const entry of entries) {
		if (entry.value) next.push(entry);
	}
	return next;
}

async function mirrorRegistryMarker(
	coreApi: CoreV1Api,
	namespace: string,
	state: { mode: string; host: string; insecure: boolean; ingressEnabled: boolean; credentialHash?: string; clusterIssuer?: string }
): Promise<void> {
	await replaceMarker(coreApi, namespace, data => {
		const next: Record<string, string> = {
			...data,
			registry_mode: state.mode,
			registry_insecure: String(state.insecure),
			registry_ingress_enabled: String(state.ingressEnabled)
		};
		if (state.host) next.registry_host = state.host;
		else delete next.registry_host;
		if (state.clusterIssuer) next.registry_cluster_issuer = state.clusterIssuer;
		else delete next.registry_cluster_issuer;
		if (state.credentialHash) next.registry_credential_hash = state.credentialHash;
		else delete next.registry_credential_hash;
		delete next.registry_apply_error;
		delete next.registry_apply_error_at;
		delete next.registry_apply_mode;
		delete next.registry_apply_fingerprint;
		return next;
	});
}

export function registryCredentialHash(desired: Extract<BuildRegistrySettings, { mode: 'external' }>): string {
	return buildRegistryCredentialHash(desired);
}

async function mirrorRegistryError(coreApi: CoreV1Api, namespace: string, desired: BuildRegistrySettings, message: string): Promise<void> {
	await replaceMarker(coreApi, namespace, data => ({
		...data,
		registry_apply_mode: desired.mode,
		registry_apply_error: message,
		registry_apply_error_at: new Date().toISOString(),
		...(desired.mode === 'external' ? { registry_apply_fingerprint: buildRegistryCredentialHash(desired) } : {})
	}));
}

async function replaceMarker(coreApi: CoreV1Api, namespace: string, mutate: (data: Record<string, string>) => Record<string, string>): Promise<void> {
	const existing = await readConfigMapOrNull(coreApi, namespace, PLATFORM_CONFIGMAP_NAME);
	if (!existing) {
		const body: V1ConfigMap = {
			apiVersion: 'v1',
			kind: 'ConfigMap',
			metadata: { name: PLATFORM_CONFIGMAP_NAME, namespace, labels: { 'app.kubernetes.io/part-of': 'kubwave' } },
			data: mutate({ current_version: env.appVersion, installed_by: 'worker', installed_at: new Date().toISOString() })
		};
		await createIgnoreConflict(() => coreApi.createNamespacedConfigMap({ namespace, body }));
		return;
	}

	await replaceWithRetry({
		label: `platform marker ${PLATFORM_CONFIGMAP_NAME}`,
		read: () => readConfigMapOrNull(coreApi, namespace, PLATFORM_CONFIGMAP_NAME),
		build: () => existing,
		carryOver: fresh => {
			const body = structuredClone(fresh) as V1ConfigMap;
			body.data = mutate(body.data ?? {});
			return body;
		},
		replace: body => coreApi.replaceNamespacedConfigMap({ name: PLATFORM_CONFIGMAP_NAME, namespace, body }),
		maxAttempts: RETRY_ATTEMPTS
	});
}

function registryPVC(namespace: string, storageClass: string): V1PersistentVolumeClaim {
	return {
		apiVersion: 'v1',
		kind: 'PersistentVolumeClaim',
		metadata: { name: REGISTRY_PVC_NAME, namespace, labels: helmLabels('registry'), annotations: keepAnnotations(namespace) },
		spec: {
			accessModes: ['ReadWriteOnce'],
			...(storageClass ? { storageClassName: storageClass } : {}),
			resources: { requests: { storage: '10Gi' } }
		}
	};
}

function registryService(namespace: string): V1Service {
	return {
		apiVersion: 'v1',
		kind: 'Service',
		metadata: { name: REGISTRY_NAME, namespace, labels: helmLabels('registry'), annotations: helmAnnotations(namespace) },
		spec: {
			type: 'ClusterIP',
			selector: { 'app.kubernetes.io/name': 'registry' },
			ports: [{ name: 'registry', port: REGISTRY_PORT, targetPort: 'registry' }]
		}
	};
}

function registryDeployment(namespace: string, nodeSelector: Record<string, string>): V1Deployment {
	return {
		apiVersion: 'apps/v1',
		kind: 'Deployment',
		metadata: { name: REGISTRY_NAME, namespace, labels: helmLabels('registry'), annotations: helmAnnotations(namespace) },
		spec: {
			replicas: 1,
			strategy: { type: 'Recreate' },
			selector: { matchLabels: { 'app.kubernetes.io/name': 'registry' } },
			template: {
				metadata: { labels: helmLabels('registry') },
				spec: {
					...(Object.keys(nodeSelector).length > 0 ? { nodeSelector } : {}),
					containers: [
						{
							name: 'registry',
							image: 'registry:2',
							imagePullPolicy: 'IfNotPresent',
							ports: [{ name: 'registry', containerPort: REGISTRY_PORT }],
							env: [
								{ name: 'REGISTRY_HTTP_ADDR', value: `0.0.0.0:${REGISTRY_PORT}` },
								{ name: 'REGISTRY_STORAGE_DELETE_ENABLED', value: 'true' },
								{ name: 'REGISTRY_AUTH', value: 'htpasswd' },
								{ name: 'REGISTRY_AUTH_HTPASSWD_REALM', value: 'kubwave-registry' },
								{ name: 'REGISTRY_AUTH_HTPASSWD_PATH', value: '/auth/htpasswd' }
							],
							volumeMounts: [
								{ name: 'data', mountPath: '/var/lib/registry' },
								{ name: 'auth', mountPath: '/auth', readOnly: true }
							],
							resources: {
								requests: { cpu: '50m', memory: '128Mi' },
								limits: { cpu: '500m', memory: '512Mi' }
							}
						}
					],
					volumes: [
						{ name: 'data', persistentVolumeClaim: { claimName: REGISTRY_PVC_NAME } },
						{ name: 'auth', secret: { secretName: REGISTRY_HTPASSWD_SECRET_NAME } }
					]
				}
			}
		}
	};
}

function registryIngress(namespace: string, effective: EffectiveRegistry, ingressClassName: string | undefined): V1Ingress {
	const annotations: Record<string, string> = {};
	if (effective.clusterIssuer) annotations['cert-manager.io/cluster-issuer'] = effective.clusterIssuer;
	return {
		apiVersion: 'networking.k8s.io/v1',
		kind: 'Ingress',
		metadata: { name: REGISTRY_NAME, namespace, labels: helmLabels('registry'), annotations: { ...helmAnnotations(namespace), ...annotations } },
		spec: {
			...(ingressClassName ? { ingressClassName } : {}),
			...(effective.clusterIssuer ? { tls: [{ hosts: [effective.host], secretName: 'kubwave-registry-tls' }] } : {}),
			rules: [
				{
					host: effective.host,
					http: {
						paths: [
							{
								path: '/',
								pathType: 'Prefix',
								backend: { service: { name: REGISTRY_NAME, port: { number: REGISTRY_PORT } } }
							}
						]
					}
				}
			]
		}
	};
}

export function registryAwareBuilderNetworkPolicy(
	existing: V1NetworkPolicy,
	effective: EffectiveRegistry | null,
	stalePublicPorts: number[] = []
): V1NetworkPolicy {
	const next = structuredClone(existing) as V1NetworkPolicy;
	const metadata = (next.metadata ??= {});
	const annotations = { ...metadata.annotations };
	let egress = [...(next.spec?.egress ?? [])].filter(rule => !isRegistryPodRule(rule));

	if (annotations[MANAGED_INGRESS_RULE_ANNOTATION] === 'true' || effective?.mode !== 'platform') {
		egress = egress.filter(rule => !isDefaultIngressControllerRule(rule));
		delete annotations[MANAGED_INGRESS_RULE_ANNOTATION];
	}

	egress = removePublicRegistryPorts(egress, [...parseManagedPublicPorts(annotations[MANAGED_PUBLIC_PORTS_ANNOTATION]), ...stalePublicPorts]);
	delete annotations[MANAGED_PUBLIC_PORTS_ANNOTATION];

	if (effective?.mode === 'platform') {
		egress.push(registryPodRule());
		if (!hasIngressControllerRule(egress)) {
			egress.push(defaultIngressControllerRule());
			annotations[MANAGED_INGRESS_RULE_ANNOTATION] = 'true';
		}
	} else if (effective?.mode === 'external') {
		const ports = externalRegistryPublicPorts(effective.endpoint);
		addPublicRegistryPorts(egress, ports);
		if (ports.length > 0) annotations[MANAGED_PUBLIC_PORTS_ANNOTATION] = ports.join(',');
	}

	metadata.annotations = annotations;
	next.spec = { ...next.spec, egress };
	return next;
}

function registryPodRule(): V1NetworkPolicyEgressRule {
	return {
		to: [{ podSelector: { matchLabels: { 'app.kubernetes.io/name': 'registry' } } }],
		ports: [{ protocol: 'TCP', port: REGISTRY_PORT }]
	};
}

function defaultIngressControllerRule(): V1NetworkPolicyEgressRule {
	return {
		to: [
			{
				namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': env.ingressControllerNamespace } },
				podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } }
			}
		],
		ports: INGRESS_CONTROLLER_EGRESS_PORTS.map(port => ({ protocol: 'TCP', port }))
	};
}

function isRegistryPodRule(rule: V1NetworkPolicyEgressRule): boolean {
	return (
		rule.to?.length === 1 && rule.to[0]?.podSelector?.matchLabels?.['app.kubernetes.io/name'] === 'registry' && sameTcpPorts(rule, [REGISTRY_PORT])
	);
}

function hasIngressControllerRule(rules: V1NetworkPolicyEgressRule[]): boolean {
	return rules.some(
		rule =>
			rule.to?.some(target => target.namespaceSelector && target.podSelector) &&
			(rule.ports ?? []).some(port => port.protocol === 'TCP' && typeof port.port === 'number' && port.port !== 53)
	);
}

function isDefaultIngressControllerRule(rule: V1NetworkPolicyEgressRule): boolean {
	const target = rule.to?.[0];
	return (
		rule.to?.length === 1 &&
		target?.namespaceSelector?.matchLabels?.['kubernetes.io/metadata.name'] === env.ingressControllerNamespace &&
		target.podSelector?.matchLabels?.['app.kubernetes.io/name'] === 'traefik' &&
		sameTcpPorts(rule, INGRESS_CONTROLLER_EGRESS_PORTS)
	);
}

function stalePublicRegistryPorts(marker: MarkerState | null, effective: EffectiveRegistry | null): number[] {
	if (marker?.registryMode !== 'external' || !marker.registryHost) return [];
	const current = effective?.mode === 'external' ? new Set(externalRegistryPublicPorts(effective.endpoint)) : new Set<number>();
	return externalRegistryPublicPorts(marker.registryHost).filter(port => !current.has(port));
}

function externalRegistryPublicPorts(endpoint: string): number[] {
	return buildRegistryNetworkPolicyEgressPorts(endpoint)?.filter(port => !PUBLIC_EGRESS_PORTS.includes(port)) ?? [];
}

function addPublicRegistryPorts(rules: V1NetworkPolicyEgressRule[], ports: number[]): void {
	const publicRule = publicEgressRule(rules);
	if (!publicRule) return;

	const existingPorts = new Set((publicRule.ports ?? []).map(port => port.port).filter((port): port is number => typeof port === 'number'));
	for (const port of ports) {
		if (existingPorts.has(port)) continue;
		(publicRule.ports ??= []).push({ protocol: 'TCP', port });
		existingPorts.add(port);
	}
}

function removePublicRegistryPorts(rules: V1NetworkPolicyEgressRule[], ports: number[]): V1NetworkPolicyEgressRule[] {
	if (ports.length === 0) return rules;
	const publicRule = publicEgressRule(rules);
	if (!publicRule) return rules;

	const stale = new Set(ports);
	publicRule.ports = (publicRule.ports ?? []).filter(port => !(typeof port.port === 'number' && stale.has(port.port)));
	return rules;
}

function parseManagedPublicPorts(raw: string | undefined): number[] {
	return (raw ?? '')
		.split(',')
		.map(port => Number(port))
		.filter(port => Number.isSafeInteger(port) && port > 0);
}

function publicEgressRule(rules: V1NetworkPolicyEgressRule[]): V1NetworkPolicyEgressRule | undefined {
	return rules.find(rule => rule.to?.some(target => target.ipBlock?.cidr === '0.0.0.0/0'));
}

function sameTcpPorts(rule: V1NetworkPolicyEgressRule, ports: number[]): boolean {
	const actual = (rule.ports ?? []).map(port => (port.protocol === 'TCP' && typeof port.port === 'number' ? port.port : NaN)).sort((a, b) => a - b);
	const expected = [...ports].sort((a, b) => a - b);
	return actual.length === expected.length && actual.every((port, index) => port === expected[index]);
}

function networkPolicySpecSignature(policy: V1NetworkPolicy): string {
	return JSON.stringify({
		annotations: policy.metadata?.annotations ?? {},
		podSelector: policy.spec?.podSelector ?? {},
		policyTypes: policy.spec?.policyTypes ?? [],
		egress: policy.spec?.egress ?? []
	});
}

function keepMetadata(name: string, namespace: string) {
	return {
		name,
		namespace,
		labels: { 'app.kubernetes.io/part-of': 'kubwave' },
		annotations: { 'helm.sh/resource-policy': 'keep' }
	};
}

function keepAnnotations(namespace: string): Record<string, string> {
	return { ...helmAnnotations(namespace), 'helm.sh/resource-policy': 'keep' };
}

function helmAnnotations(namespace: string): Record<string, string> {
	return { 'meta.helm.sh/release-name': 'kubwave', 'meta.helm.sh/release-namespace': namespace };
}

function helmLabels(component: string): Record<string, string> {
	return {
		'app.kubernetes.io/part-of': 'kubwave',
		'app.kubernetes.io/managed-by': 'Helm',
		'app.kubernetes.io/instance': 'kubwave',
		'app.kubernetes.io/name': component,
		'app.kubernetes.io/component': component
	};
}

function passwordFromDockerConfig(secret: V1Secret): string | undefined {
	const encoded = secret.data?.['.dockerconfigjson'];
	if (!encoded) return undefined;
	try {
		const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
			auths?: Record<string, { password?: string }>;
		};
		const entry = Object.values(parsed.auths ?? {}).find(auth => typeof auth.password === 'string' && auth.password.length > 0);
		return entry?.password;
	} catch {
		return undefined;
	}
}

function parseStringRecord(raw: string | undefined): Record<string, string> | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
		return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]));
	} catch {
		return undefined;
	}
}

function parseIngressClassName(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as { traefik?: { ingressClassName?: unknown } };
		return typeof parsed.traefik?.ingressClassName === 'string' ? parsed.traefik.ingressClassName : undefined;
	} catch {
		return undefined;
	}
}
