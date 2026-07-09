import { describe, expect, test } from 'bun:test';
import type { KubeConfig } from '@kubernetes/client-node';
import {
	ensureAutoscalerSecret,
	hasUpcloudAutoscalerOwnership,
	parseUpcloudNodeGroup,
	renderAutoscalerDeployment,
	renderAutoscalerManifests,
	resolveAutoscalerImageTag,
	UPCLOUD_AUTOSCALER_IMAGE_TAG_PLACEHOLDER,
	UPCLOUD_AUTOSCALER_NODES_FLAGS_PLACEHOLDER,
	UPCLOUD_CLUSTER_ID_PLACEHOLDER
} from '../src/platforms/upcloud/autoscaling.js';
import { buildOwnershipLabels } from '../src/lib/ownership.js';

const SAMPLE_UUID = '01234567-89ab-cdef-0123-456789abcdef';

function mockKubeConfig(clients: Record<string, unknown>): KubeConfig {
	return {
		makeApiClient: (ctor: { name: string }) => {
			const client = clients[ctor.name] ?? clients[ctor.name.replace(/^Object/, '')];
			if (!client) throw new Error(`No mock client registered for ${ctor.name}`);
			return client;
		}
	} as unknown as KubeConfig;
}

describe('UpCloud autoscaler manifests', () => {
	test('substitutes cluster UUID and image tag in deployment manifest', () => {
		const rendered = renderAutoscalerDeployment({ clusterUuid: SAMPLE_UUID, imageTag: 'v1.28.6' });
		expect(rendered).toContain(SAMPLE_UUID);
		expect(rendered).toContain('ghcr.io/upcloudltd/autoscaler:v1.28.6');
		expect(rendered).not.toContain(UPCLOUD_CLUSTER_ID_PLACEHOLDER);
		expect(rendered).not.toContain(UPCLOUD_AUTOSCALER_IMAGE_TAG_PLACEHOLDER);
	});

	test('includes node group flags when configured', () => {
		const rendered = renderAutoscalerDeployment({
			clusterUuid: SAMPLE_UUID,
			imageTag: 'v1.29.5',
			nodeGroups: [
				{ name: 'monitor', min: 2, max: 10 },
				{ name: 'dev', min: 2, max: 3 }
			]
		});
		expect(rendered).toContain('--nodes=2:10:monitor');
		expect(rendered).toContain('--nodes=2:3:dev');
		expect(rendered).not.toContain(UPCLOUD_AUTOSCALER_NODES_FLAGS_PLACEHOLDER);
	});

	test('combined manifest includes RBAC, deployment and configured values', () => {
		const rendered = renderAutoscalerManifests({ clusterUuid: SAMPLE_UUID, imageTag: 'v1.27.8' });
		expect(rendered).toContain('kind: ClusterRole');
		expect(rendered).toContain('kind: Deployment');
		expect(rendered).toContain(SAMPLE_UUID);
		expect(rendered).toContain('ghcr.io/upcloudltd/autoscaler:v1.27.8');
	});

	test('ownership helper matches kubwave-installed labels', () => {
		const labels = buildOwnershipLabels({ component: 'platform', instance: 'upcloud-autoscaler', cliManaged: true });
		expect(hasUpcloudAutoscalerOwnership(labels)).toBe(true);
		expect(hasUpcloudAutoscalerOwnership({ 'app.kubernetes.io/part-of': 'kubwave' })).toBe(false);
	});
});

describe('parseUpcloudNodeGroup', () => {
	test('parses valid <min>:<max>:<name> spec', () => {
		expect(parseUpcloudNodeGroup('2:10:workers')).toEqual({ name: 'workers', min: 2, max: 10 });
	});

	test('rejects invalid format', () => {
		expect(() => parseUpcloudNodeGroup('2:workers')).toThrow('Invalid node group spec');
	});

	test('rejects negative min', () => {
		expect(() => parseUpcloudNodeGroup('-1:10:workers')).toThrow('non-negative integer');
	});

	test('rejects max below min', () => {
		expect(() => parseUpcloudNodeGroup('5:3:workers')).toThrow('integer >= min');
	});

	test('accepts alphanumeric and hyphenated names', () => {
		expect(parseUpcloudNodeGroup('1:3:gpu-pool-1')).toEqual({ name: 'gpu-pool-1', min: 1, max: 3 });
	});

	test.each(['2:10:my workers', '2:10:work\ners', '2:10:pool$(rm)', "2:10:a'b"])('rejects names with unsafe characters: %j', spec => {
		expect(() => parseUpcloudNodeGroup(spec)).toThrow('only letters, digits and hyphens');
	});
});

describe('resolveAutoscalerImageTag', () => {
	test('override wins over cluster version', () => {
		expect(resolveAutoscalerImageTag('v1.27.1', 'custom-tag')).toEqual({ tag: 'custom-tag', defaulted: false });
	});

	test('maps k8s minor versions to UpCloud autoscaler tags', () => {
		expect(resolveAutoscalerImageTag('v1.27.1', undefined)).toEqual({ tag: 'v1.27.8', defaulted: false });
		expect(resolveAutoscalerImageTag('v1.28.4', undefined)).toEqual({ tag: 'v1.28.6', defaulted: false });
		expect(resolveAutoscalerImageTag('v1.29.5', undefined)).toEqual({ tag: 'v1.29.5', defaulted: false });
		expect(resolveAutoscalerImageTag('v1.30.0', undefined)).toEqual({ tag: 'v1.29.5', defaulted: false });
	});

	test('falls back when version is unknown or too old', () => {
		expect(resolveAutoscalerImageTag(undefined, undefined)).toEqual({ tag: 'v1.29.5', defaulted: true });
		expect(resolveAutoscalerImageTag('v1.26.0', undefined)).toEqual({ tag: 'v1.29.5', defaulted: true });
	});
});

describe('ensureAutoscalerSecret', () => {
	test('creates secret with token when token auth is used', async () => {
		const calls: Array<{ body: { stringData: Record<string, string>; metadata: { labels: Record<string, string> } } }> = [];
		const createNamespacedSecret = async (opts: { body: { stringData: Record<string, string>; metadata: { labels: Record<string, string> } } }) => {
			calls.push(opts);
			return { metadata: {} };
		};
		const kc = mockKubeConfig({ CoreV1Api: { createNamespacedSecret } });

		await ensureAutoscalerSecret(kc, { token: 'secret-token' });

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error('expected createNamespacedSecret to be called');
		expect(call.body.stringData).toEqual({ token: 'secret-token' });
		expect(call.body.metadata.labels).toMatchObject({ 'app.kubernetes.io/part-of': 'kubwave' });
	});

	test('creates secret with username and password when basic auth is used', async () => {
		const calls: Array<{ body: { stringData: Record<string, string> } }> = [];
		const createNamespacedSecret = async (opts: { body: { stringData: Record<string, string> } }) => {
			calls.push(opts);
			return { metadata: {} };
		};
		const kc = mockKubeConfig({ CoreV1Api: { createNamespacedSecret } });

		await ensureAutoscalerSecret(kc, { username: 'user', password: 'pass' });

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error('expected createNamespacedSecret to be called');
		expect(call.body.stringData).toEqual({ username: 'user', password: 'pass' });
	});

	test('replaces existing secret preserving ownership labels', async () => {
		const createNamespacedSecret = async () => {
			const err = new Error('already exists');
			(err as Error & { statusCode?: number }).statusCode = 409;
			throw err;
		};
		const replaceCalls: Array<{ body: { stringData: Record<string, string>; metadata: { resourceVersion: string } } }> = [];
		const readNamespacedSecret = async () => ({
			metadata: {
				resourceVersion: '42',
				labels: buildOwnershipLabels({ component: 'platform', instance: 'upcloud-autoscaler', cliManaged: true })
			}
		});
		const replaceNamespacedSecret = async (opts: { body: { stringData: Record<string, string>; metadata: { resourceVersion: string } } }) => {
			replaceCalls.push(opts);
			return { metadata: {} };
		};
		const kc = mockKubeConfig({ CoreV1Api: { createNamespacedSecret, readNamespacedSecret, replaceNamespacedSecret } });

		await ensureAutoscalerSecret(kc, { token: 'secret-token' });

		expect(replaceCalls).toHaveLength(1);
		const call = replaceCalls[0];
		if (!call) throw new Error('expected replaceNamespacedSecret to be called');
		expect(call.body.metadata.resourceVersion).toBe('42');
		expect(call.body.stringData).toEqual({ token: 'secret-token' });
	});

	test('refuses to overwrite an existing secret not managed by kubwave', async () => {
		const createNamespacedSecret = async () => {
			const err = new Error('already exists');
			(err as Error & { statusCode?: number }).statusCode = 409;
			throw err;
		};
		let replaceCalled = false;
		const readNamespacedSecret = async () => ({ metadata: { resourceVersion: '7', labels: { app: 'someone-elses-autoscaler' } } });
		const replaceNamespacedSecret = async () => {
			replaceCalled = true;
			return { metadata: {} };
		};
		const kc = mockKubeConfig({ CoreV1Api: { createNamespacedSecret, readNamespacedSecret, replaceNamespacedSecret } });

		await expect(ensureAutoscalerSecret(kc, { token: 'secret-token' })).rejects.toThrow('not managed by kubwave');
		expect(replaceCalled).toBe(false);
	});
});
