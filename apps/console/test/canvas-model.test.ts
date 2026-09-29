import { describe, expect, test } from 'bun:test';
import { tidyLayout, volumeUsage } from '../features/project/canvas-model';
import { serviceDomain, serviceSource, serviceVolume } from '../lib/service-types';

type Minimal = Parameters<typeof serviceSource>[0];
const service = (type: string, config: Record<string, unknown>, defaultUrl: string | null = null) =>
	({ type, config, defaultUrl }) as unknown as Minimal & Parameters<typeof serviceDomain>[0] & Parameters<typeof serviceVolume>[0];

describe('serviceSource', () => {
	test('describes where each service type comes from', () => {
		expect(serviceSource(service('docker-image', { image: 'nginx', tag: '1.27' }))).toEqual({ label: 'nginx:1.27' });
		expect(serviceSource(service('github-repo', { repoFullName: 'acme/web', repoUrl: 'https://github.com/acme/web', branch: 'main' }))).toEqual({
			label: 'acme/web',
			branch: 'main'
		});
		expect(serviceSource(service('public-repo', { repoUrl: 'https://gitlab.com/acme/api.git', branch: 'dev' }))).toEqual({
			label: 'gitlab.com/acme/api',
			branch: 'dev'
		});
		expect(serviceSource(service('postgres', { version: '16' }))).toEqual({ label: 'PostgreSQL 16' });
		expect(serviceSource(service('dockerfile', { dockerfile: 'FROM x' }))).toEqual({ label: 'Built from Dockerfile' });
	});
});

describe('serviceDomain', () => {
	test('prefers a custom domain, then the default URL host, else none', () => {
		expect(serviceDomain(service('docker-image', { domains: [{ host: 'shop.acme.dev', port: 80 }] }, 'https://web-1a2b.apps.dev'))).toBe(
			'shop.acme.dev'
		);
		expect(serviceDomain(service('docker-image', { domains: [] }, 'https://web-1a2b.apps.dev'))).toBe('web-1a2b.apps.dev');
		expect(serviceDomain(service('postgres', { domains: [] }))).toBeNull();
	});
});

describe('serviceVolume', () => {
	test("shows an app's first volume and a database's managed data volume", () => {
		expect(serviceVolume(service('docker-image', { volumes: [{ name: 'uploads', mountPath: '/data', size: '2Gi' }] }))).toEqual({
			name: 'uploads',
			mountPath: '/data',
			size: '2Gi'
		});
		expect(serviceVolume(service('postgres', { version: '16', storage: { size: '5Gi' }, volumes: [] }))).toEqual({
			name: 'data',
			mountPath: '/var/lib/postgresql/data',
			size: '5Gi'
		});
		expect(serviceVolume(service('mongodb', { version: '7', storage: { size: '1Gi' }, volumes: [] }))!.mountPath).toBe('/data/db');
		expect(serviceVolume(service('docker-image', { volumes: [] }))).toBeNull();
	});
});

describe('volumeUsage', () => {
	const GiB = 1024 ** 3;
	test('reports usage of a size-enforced volume', () => {
		expect(volumeUsage('1Gi', { usedBytes: GiB / 4, capacityBytes: GiB })).toEqual({
			usedBytes: GiB / 4,
			capacityBytes: GiB,
			pct: 25,
			nodeDisk: false
		});
	});
	test('keeps usage when the provider rounds a small claim up to its minimum size', () => {
		expect(volumeUsage('1Gi', { usedBytes: GiB, capacityBytes: 10 * GiB })).toMatchObject({ pct: 10, nodeDisk: false });
	});
	test('flags usage from a volume that reports the whole node disk', () => {
		expect(volumeUsage('1Gi', { usedBytes: 910 * GiB, capacityBytes: 1300 * GiB })).toMatchObject({ pct: 70, nodeDisk: true });
		expect(volumeUsage('1Gi', null)).toBeNull();
	});
});

describe('tidyLayout', () => {
	const services = [
		{ id: 'web', type: 'docker-image' },
		{ id: 'api', type: 'github-repo' },
		{ id: 'db', type: 'postgres' },
		{ id: 'worker', type: 'github-repo' }
	];

	test('puts consumers left of what they depend on and databases in the last column', () => {
		const layout = tidyLayout(services, [
			{ sourceServiceId: 'web', targetServiceId: 'api' },
			{ sourceServiceId: 'api', targetServiceId: 'db' },
			{ sourceServiceId: 'worker', targetServiceId: 'db' }
		]);
		expect(layout.web!.x).toBeLessThan(layout.api!.x);
		expect(layout.api!.x).toBeLessThan(layout.db!.x);
		expect(layout.worker!.x).toBe(layout.api!.x);
		expect(layout.api!.y).not.toBe(layout.worker!.y);
	});

	test('stacks a database with the other dependencies of its callers instead of behind them', () => {
		const layout = tidyLayout(
			[
				{ id: 'web', type: 'docker-image' },
				{ id: 'api', type: 'docker-image' },
				{ id: 'cache', type: 'docker-image' },
				{ id: 'db', type: 'postgres' }
			],
			[
				{ sourceServiceId: 'web', targetServiceId: 'api' },
				{ sourceServiceId: 'api', targetServiceId: 'cache' },
				{ sourceServiceId: 'api', targetServiceId: 'db' }
			]
		);
		expect(layout.db!.x).toBe(layout.cache!.x);
		expect(layout.db!.y).not.toBe(layout.cache!.y);
	});

	test('moves an entry point next to its nearest dependency so its edge does not cross other columns', () => {
		const layout = tidyLayout(
			[
				{ id: 'web', type: 'docker-image' },
				{ id: 'api', type: 'docker-image' },
				{ id: 'db', type: 'postgres' },
				{ id: 'adminer', type: 'docker-image' }
			],
			[
				{ sourceServiceId: 'web', targetServiceId: 'api' },
				{ sourceServiceId: 'api', targetServiceId: 'db' },
				{ sourceServiceId: 'adminer', targetServiceId: 'db' }
			]
		);
		expect(layout.adminer!.x).toBe(layout.api!.x);
		expect(layout.web!.x).toBeLessThan(layout.api!.x);
	});

	test('orders each column by the rows of its callers so edges do not cross', () => {
		const layout = tidyLayout(
			[
				{ id: 'db', type: 'postgres' },
				{ id: 'cache', type: 'docker-image' },
				{ id: 'api', type: 'docker-image' },
				{ id: 'web', type: 'docker-image' },
				{ id: 'adminer', type: 'docker-image' }
			],
			[
				{ sourceServiceId: 'web', targetServiceId: 'api' },
				{ sourceServiceId: 'api', targetServiceId: 'cache' },
				{ sourceServiceId: 'api', targetServiceId: 'db' },
				{ sourceServiceId: 'adminer', targetServiceId: 'db' }
			]
		);
		expect(layout.cache!.y).toBe(layout.api!.y);
		expect(layout.db!.y).toBe(layout.adminer!.y);
		expect(layout.api!.y).toBeLessThan(layout.adminer!.y);
	});

	test('keeps an unreferenced database right of the apps', () => {
		const layout = tidyLayout(
			[
				{ id: 'web', type: 'docker-image' },
				{ id: 'db', type: 'postgres' }
			],
			[]
		);
		expect(layout.db!.x).toBeGreaterThan(layout.web!.x);
	});

	test('keeps positions on the flow grid and survives reference cycles', () => {
		const layout = tidyLayout(services.slice(0, 2), [
			{ sourceServiceId: 'web', targetServiceId: 'api' },
			{ sourceServiceId: 'api', targetServiceId: 'web' }
		]);
		for (const position of Object.values(layout)) {
			expect(position.x % 22).toBe(0);
			expect(position.y % 22).toBe(0);
		}
	});
});
