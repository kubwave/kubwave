import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { CoreV1Api, V1Secret } from '@kubernetes/client-node';
import type { Deployment, DeploymentLogEntry, DockerImageServiceConfig } from '@kubwave/db';
import { encryptSecret } from '@kubwave/crypto';
import {
	buildFilesSecret,
	convergeConfigFiles,
	filesChecksum,
	filesSecretName
} from '~/modules/worker/jobs/deployments/deployers/runtime/config-files';
import { buildDeployment, deploymentMatchesConfig } from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const FILES_SECRET_NAME = `svc-${SERVICE_ID}-files`;
const IMAGE_REF = 'kong:3.9';
const deployment = { serviceId: SERVICE_ID } as Deployment;

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

function configWith(configFiles: DockerImageServiceConfig['configFiles']): DockerImageServiceConfig {
	return { image: 'kong', tag: '3.9', containerPort: 8000, env: [], secrets: [], domains: [], volumes: [], ...(configFiles ? { configFiles } : {}) };
}

describe('filesSecretName', () => {
	test('is distinct from the env Secret', () => {
		expect(filesSecretName(SERVICE_ID)).toBe(FILES_SECRET_NAME);
	});
});

describe('buildFilesSecret', () => {
	test('decrypts content into stringData keyed by fileKey', () => {
		const config = configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('_format_version: "3.0"') }]);
		const secret = buildFilesSecret(SERVICE_ID, NAMESPACE, config);
		expect(secret.metadata?.name).toBe(FILES_SECRET_NAME);
		expect(secret.stringData).toEqual({ 'home_kong_kong.yml': '_format_version: "3.0"' });
		// Ciphertext must not leak into the rendered Secret.
		expect(JSON.stringify(secret.stringData)).not.toContain(config.configFiles![0]!.content);
	});
});

describe('filesChecksum', () => {
	test('is null with no files and changes when content changes', () => {
		expect(filesChecksum(configWith([]))).toBeNull();
		const a = filesChecksum(configWith([{ path: '/x', content: encryptSecret('one') }]));
		const b = filesChecksum(configWith([{ path: '/x', content: encryptSecret('two') }]));
		expect(a).toBeString();
		expect(a).not.toBe(b);
	});
});

// Fake CoreV1Api over a name→secret map (404 when missing), driving convergeConfigFiles through the real ops helpers.
function fakeApi(initial: Record<string, V1Secret> = {}) {
	const store = { ...initial };
	const calls = { create: 0, replace: 0, delete: 0 };
	const api = {
		readNamespacedSecret: async ({ name }: { name: string }) => {
			const s = store[name];
			if (!s) throw { code: 404 };
			return s;
		},
		createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
			calls.create++;
			store[body.metadata!.name!] = body;
			return body;
		},
		replaceNamespacedSecret: async ({ name, body }: { name: string; body: V1Secret }) => {
			calls.replace++;
			store[name] = body;
			return body;
		},
		deleteNamespacedSecret: async ({ name }: { name: string }) => {
			calls.delete++;
			delete store[name];
			return {};
		}
	} as unknown as CoreV1Api;
	return { api, calls, store };
}

function liveFilesSecret(data: Record<string, string>): V1Secret {
	return {
		metadata: { name: FILES_SECRET_NAME, namespace: NAMESPACE, resourceVersion: '42' },
		data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Buffer.from(v).toString('base64')]))
	};
}

describe('convergeConfigFiles', () => {
	test('creates the Secret when files exist and none is live', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi();
		await convergeConfigFiles(api, NAMESPACE, SERVICE_ID, configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('v1') }]), events);
		expect(calls).toEqual({ create: 1, replace: 0, delete: 0 });
		expect(events.map(e => e.step)).toEqual(['config-files-converged']);
		expect(events[0]?.message).toContain('Created Secret');
	});

	test('no-op when the live Secret already matches', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi({ [FILES_SECRET_NAME]: liveFilesSecret({ 'home_kong_kong.yml': 'v1' }) });
		await convergeConfigFiles(api, NAMESPACE, SERVICE_ID, configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('v1') }]), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(events).toEqual([]);
	});

	test('replaces the live Secret when content changed', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi({ [FILES_SECRET_NAME]: liveFilesSecret({ 'home_kong_kong.yml': 'old' }) });
		await convergeConfigFiles(api, NAMESPACE, SERVICE_ID, configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('new') }]), events);
		expect(calls).toEqual({ create: 0, replace: 1, delete: 0 });
		expect(events[0]?.message).toContain('Updated Secret');
	});

	test('deletes the live Secret when no files remain', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi({ [FILES_SECRET_NAME]: liveFilesSecret({ 'home_kong_kong.yml': 'v1' }) });
		await convergeConfigFiles(api, NAMESPACE, SERVICE_ID, configWith([]), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 1 });
		expect(events[0]?.message).toContain('Removed Secret');
	});

	test('no-op when there are no files and none is live', async () => {
		const events: DeploymentLogEntry[] = [];
		const { api, calls } = fakeApi();
		await convergeConfigFiles(api, NAMESPACE, SERVICE_ID, configWith([]), events);
		expect(calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(events).toEqual([]);
	});
});

describe('buildDeployment config-file mounts', () => {
	test('mounts each file at its path via subPath from the files Secret', () => {
		const config = configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('cfg') }]);
		const podSpec = buildDeployment(deployment, NAMESPACE, config, IMAGE_REF).spec!.template!.spec!;
		const container = podSpec.containers[0]!;
		const mount = (container.volumeMounts ?? []).find(m => m.mountPath === '/home/kong/kong.yml');
		expect(mount).toBeDefined();
		expect(mount!.subPath).toBe('home_kong_kong.yml');
		const vol = (podSpec.volumes ?? []).find(v => v.secret?.secretName === FILES_SECRET_NAME);
		expect(vol).toBeDefined();
		expect(mount!.name).toBe(vol!.name);
	});

	test('stamps a config-files checksum annotation only when files exist', () => {
		const withFiles = buildDeployment(deployment, NAMESPACE, configWith([{ path: '/x', content: encryptSecret('a') }]), IMAGE_REF);
		expect(withFiles.spec?.template?.metadata?.annotations?.['kubwave/config-files-checksum']).toBeString();
		const without = buildDeployment(deployment, NAMESPACE, configWith([]), IMAGE_REF);
		expect(without.spec?.template?.metadata?.annotations?.['kubwave/config-files-checksum']).toBeUndefined();
	});
});

describe('deploymentMatchesConfig with config files', () => {
	test('a converged Deployment matches its own config', () => {
		const config = configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('v1') }]);
		const built = buildDeployment(deployment, NAMESPACE, config, IMAGE_REF);
		expect(deploymentMatchesConfig(built, config, IMAGE_REF, SERVICE_ID)).toBe(true);
	});

	test('a changed file content is a mismatch', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('v1') }]), IMAGE_REF);
		const next = configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('v2') }]);
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	test('adding a config file is a mismatch', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith([]), IMAGE_REF);
		const next = configWith([{ path: '/home/kong/kong.yml', content: encryptSecret('v1') }]);
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(false);
	});
});
