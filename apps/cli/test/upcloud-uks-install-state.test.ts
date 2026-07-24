import { describe, expect, test } from 'bun:test';
import { buildInstallState, decodeInstallStateData, encodeInstallStateData } from '../src/lib/install-state.js';
import type { InstallConfig } from '../src/lib/helm.js';
import { upcloudUksDescriptor } from '../src/platforms/upcloud/descriptor.js';
import { resolveDependencyState } from '../src/lib/dependencies.js';

describe('upcloud-uks install state marker', () => {
	test('round-trips platform_id through marker encode/decode', async () => {
		const platform = await upcloudUksDescriptor.build({});
		const dependencies = resolveDependencyState({ platformState: platform.dependencies });
		const config: InstallConfig = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '1.0.0',
			imageRegistry: 'ghcr.io/acme',
			namespace: 'kubwave',
			storageClass: 'upcloud-block-storage-maxiops',
			dependencies,
			ha: false
		};

		const state = buildInstallState(config, 'upcloud-uks');
		expect(state.platformId).toBe('upcloud-uks');
		expect(state.upcloudAutoscaling).toBeUndefined();

		const encoded = encodeInstallStateData(state);
		expect(encoded.platform_id).toBe('upcloud-uks');
		expect(encoded.upcloud_autoscaling_json).toBeUndefined();

		const decoded = decodeInstallStateData(encoded);
		expect(decoded?.platformId).toBe('upcloud-uks');
	});

	test('round-trips upcloud autoscaling state without secrets', async () => {
		const platform = await upcloudUksDescriptor.build({});
		const dependencies = resolveDependencyState({ platformState: platform.dependencies });
		const config: InstallConfig = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '1.0.0',
			imageRegistry: 'ghcr.io/acme',
			namespace: 'kubwave',
			storageClass: 'upcloud-block-storage-maxiops',
			dependencies,
			ha: false,
			upcloudAutoscaling: { enabled: true, clusterUuid: '01234567-89ab-cdef-0123-456789abcdef' }
		};

		const state = buildInstallState(config, 'upcloud-uks');
		expect(state.upcloudAutoscaling).toEqual({ enabled: true, clusterUuid: '01234567-89ab-cdef-0123-456789abcdef' });

		const encoded = encodeInstallStateData(state);
		expect(encoded.upcloud_autoscaling_json).toBe(JSON.stringify(state.upcloudAutoscaling));
		expect(encoded.upcloud_autoscaling_json).not.toContain('password');
		expect(encoded.upcloud_autoscaling_json).not.toContain('username');
		expect(encoded.upcloud_autoscaling_json).not.toContain('token');

		const decoded = decodeInstallStateData(encoded);
		expect(decoded?.upcloudAutoscaling).toEqual(state.upcloudAutoscaling);
	});

	test('round-trips upcloud autoscaling state with node groups', async () => {
		const platform = await upcloudUksDescriptor.build({});
		const dependencies = resolveDependencyState({ platformState: platform.dependencies });
		const nodeGroups = [
			{ name: 'workers', min: 2, max: 10 },
			{ name: 'spot', min: 0, max: 5 }
		];
		const config: InstallConfig = {
			domain: 'app.example.com',
			email: 'ops@example.com',
			version: '1.0.0',
			imageRegistry: 'ghcr.io/acme',
			namespace: 'kubwave',
			storageClass: 'upcloud-block-storage-maxiops',
			dependencies,
			ha: false,
			upcloudAutoscaling: { enabled: true, clusterUuid: '01234567-89ab-cdef-0123-456789abcdef', nodeGroups }
		};

		const state = buildInstallState(config, 'upcloud-uks');
		expect(state.upcloudAutoscaling).toEqual({ enabled: true, clusterUuid: '01234567-89ab-cdef-0123-456789abcdef', nodeGroups });

		const encoded = encodeInstallStateData(state);
		expect(encoded.upcloud_autoscaling_json).toBe(JSON.stringify(state.upcloudAutoscaling));

		const decoded = decodeInstallStateData(encoded);
		expect(decoded?.upcloudAutoscaling).toEqual(state.upcloudAutoscaling);
	});

	test('drops malformed node groups during decode', async () => {
		const encoded = {
			upcloud_autoscaling_json: JSON.stringify({
				enabled: true,
				clusterUuid: '01234567-89ab-cdef-0123-456789abcdef',
				nodeGroups: [
					{ name: 'valid', min: 1, max: 3 },
					{ name: 'bad', min: 5, max: 2 },
					{ name: '', min: 0, max: 1 }
				]
			})
		};

		const decoded = decodeInstallStateData(encoded);
		expect(decoded?.upcloudAutoscaling?.nodeGroups).toEqual([{ name: 'valid', min: 1, max: 3 }]);
	});
});
