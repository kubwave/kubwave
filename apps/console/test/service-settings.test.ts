import { describe, expect, test } from 'bun:test';
import type { Service } from '../lib/api/types';
import {
	buildServiceUpdate,
	changedGroups,
	importDotenv,
	settingsErrors,
	snapshotService,
	type ServiceSettingsValues
} from '../lib/service-settings';

function service(type: Service['type'], config: Record<string, unknown>, extra: Partial<Service> = {}): Service {
	return {
		id: 'svc-1',
		environmentId: 'env-1',
		name: 'web',
		description: '',
		type,
		config: { containerPort: 8080, defaultDomainEnabled: true, env: [], secrets: [], domains: [], volumes: [], ...config },
		autoDeploy: { enabled: false, lastPolledCommit: null, lastPolledAt: null, nextPollAt: null, lastPollError: null },
		imageWatch: { enabled: true, lastDigest: null, lastCheckedAt: null, nextCheckAt: null, lastError: null },
		internalDomain: 'svc-1',
		defaultUrl: null,
		exposedEndpoints: [],
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z',
		...extra
	} as Service;
}

const image = service('docker-image', {
	image: 'nginx',
	tag: '1.27',
	env: [{ key: 'MODE', value: 'prod' }],
	secrets: [{ key: 'TOKEN', hasValue: true }],
	domains: [{ host: 'shop.acme.dev', port: 8080 }],
	volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }]
});

const edit = (values: ServiceSettingsValues, change: (draft: ServiceSettingsValues) => void) => {
	const draft = structuredClone(values);
	change(draft);
	return draft;
};

describe('buildServiceUpdate', () => {
	test('round-trips an untouched docker-image service and keeps stored secrets', () => {
		const update = buildServiceUpdate(image, snapshotService(image));
		expect(update).toMatchObject({
			name: 'web',
			imageWatch: { enabled: true },
			config: {
				image: 'nginx',
				tag: '1.27',
				containerPort: 8080,
				defaultDomainEnabled: true,
				env: [{ key: 'MODE', value: 'prod' }],
				secrets: [{ key: 'TOKEN', value: null }],
				domains: [{ host: 'shop.acme.dev', port: 8080 }],
				volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }],
				healthCheck: { enabled: false, type: 'http' },
				autoscaling: { enabled: false },
				basicAuth: { enabled: false },
				registryAuth: { enabled: false },
				command: [],
				args: [],
				configFiles: []
			}
		});
		expect(update).not.toHaveProperty('autoDeploy');
	});

	test('sends a typed secret, drops blank rows and turns off the default domain without a port', () => {
		const values = edit(snapshotService(image), draft => {
			draft.secrets[0]!.value = 'rotated';
			draft.env.push({ _id: 'x', key: '  ', value: 'ignored' });
			draft.containerPort = '';
		});
		const { config } = buildServiceUpdate(image, values);
		expect(config).toMatchObject({
			secrets: [{ key: 'TOKEN', value: 'rotated' }],
			env: [{ key: 'MODE', value: 'prod' }],
			containerPort: null,
			defaultDomainEnabled: false
		});
	});

	test('builds repo fields and auto-deploy for a GitHub service', () => {
		const github = service('github-repo', {
			installationId: 'inst-1',
			repoFullName: 'acme/web',
			repoUrl: 'https://github.com/acme/web',
			branch: 'main',
			builder: 'nixpacks'
		});
		const values = edit(snapshotService(github), draft => {
			draft.buildCommand = 'bun run build';
			draft.watchPaths = 'apps/web\npackages';
			draft.autoDeploy.enabled = true;
		});
		const update = buildServiceUpdate(github, values);
		expect(update.autoDeploy).toEqual({ enabled: true });
		expect(update.config).toMatchObject({
			installationId: 'inst-1',
			repoFullName: 'acme/web',
			branch: 'main',
			builder: 'nixpacks',
			buildCommand: 'bun run build',
			watchPaths: ['apps/web', 'packages']
		});
		expect(update).not.toHaveProperty('imageWatch');
	});

	test('keeps immutable database fields and only sends database-relevant config', () => {
		const postgres = service('postgres', { version: '16', storage: { size: '1Gi' }, database: 'app', username: 'app', containerPort: 5432 });
		const { config } = buildServiceUpdate(
			postgres,
			edit(snapshotService(postgres), draft => (draft.storage = '2Gi'))
		);
		expect(config).toEqual({ version: '16', storage: { size: '2Gi' }, database: 'app', username: 'app', env: [], secrets: [], exposedPorts: [] });
	});
});

describe('settingsErrors', () => {
	test('accepts a valid snapshot', () => {
		expect(settingsErrors(image, snapshotService(image))).toEqual({});
	});

	test('reports field paths with the old console messages', () => {
		const values = edit(snapshotService(image), draft => {
			draft.containerPort = '70000';
			draft.basicAuth.enabled = true;
			draft.autoscaling.enabled = true;
			draft.volumes[0]!.size = '1Gi';
		});
		expect(settingsErrors(image, values)).toMatchObject({
			containerPort: 'Use a port between 1 and 65535.',
			'basicAuth.username': 'A username is required when basic auth is enabled.',
			'basicAuth.password': 'A password is required when basic auth is enabled.',
			'autoscaling.enabled': 'Disable autoscaling to use a volume — a volume pins the service to one instance.',
			'volumes.0.size': 'Volumes can only grow (was 5Gi).'
		});
	});

	test('mirrors the API rules for variable names, volumes and domains', () => {
		const values = edit(snapshotService(image), draft => {
			draft.env.push({ _id: 'e', key: '1BAD-KEY', value: 'x' });
			draft.secrets.push({ _id: 's', key: 'has space', value: 'x', hasValue: false });
			draft.volumes.push({ _id: 'v', name: 'My_Data', mountPath: 'data', size: 'lots', subPath: '/abs' });
			draft.domains.push({ _id: 'd', host: 'not a host', port: '80' });
		});
		const errors = settingsErrors(image, values);
		const env = values.env.length - 1;
		const volume = values.volumes.length - 1;
		const domain = values.domains.length - 1;
		expect(errors).toMatchObject({
			[`env.${env}.key`]: 'Use letters, digits and underscores; start with a letter or underscore.',
			'secrets.1.key': 'Use letters, digits and underscores; start with a letter or underscore.',
			[`volumes.${volume}.name`]: 'Use lowercase letters, digits and dashes.',
			[`volumes.${volume}.mountPath`]: 'Use an absolute path like /data.',
			[`volumes.${volume}.size`]: 'Use a size like 1Gi or 500Mi.',
			[`volumes.${volume}.subPath`]: 'Use a relative path without a leading slash.',
			[`domains.${domain}.host`]: 'Enter a valid hostname.'
		});
	});

	test('rejects a public path that would expose every route', () => {
		const values = edit(snapshotService(image), draft => {
			draft.basicAuth = { enabled: true, username: 'ops', password: 'pw', publicPaths: '/health\n//*', hasPassword: false };
		});
		expect(settingsErrors(image, values)['basicAuth.publicPaths']).toBe('"/" makes every route public — disable basic auth instead.');
	});
});

describe('changedGroups', () => {
	test('names the sections a draft touches', () => {
		const baseline = snapshotService(image);
		const values = edit(baseline, draft => {
			draft.env[0]!.value = 'staging';
			draft.domains = [];
			draft.name = 'web-2';
		});
		expect(changedGroups(baseline, values)).toEqual(['general', 'networking', 'variables']);
		expect(changedGroups(baseline, structuredClone(baseline))).toEqual([]);
	});
});

describe('importDotenv', () => {
	test('moves pasted keys into the chosen list and out of the other one', () => {
		const values = snapshotService(image);
		const imported = importDotenv(
			values,
			[
				{ key: 'MODE', value: 'secret-mode' },
				{ key: 'NEW', value: '1' }
			],
			true
		);
		expect(imported.env.map(e => e.key)).toEqual([]);
		expect(imported.secrets.map(s => [s.key, s.value])).toEqual([
			['TOKEN', ''],
			['MODE', 'secret-mode'],
			['NEW', '1']
		]);
	});
});
