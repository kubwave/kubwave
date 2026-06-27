import { describe, expect, test } from 'bun:test';
import { deriveServiceConnections } from '../app/utils/service-connections';
import type { Service } from '~/utils/types';

function service(id: string, internalDomain: string | null, env: Array<{ key: string; value: string }> = []): Service {
	return {
		id,
		environmentId: 'env-1',
		name: id,
		description: '',
		type: 'docker-image',
		config: {
			image: `ghcr.io/acme/${id}`,
			tag: 'latest',
			containerPort: internalDomain ? 80 : null,
			defaultDomainEnabled: false,
			env,
			secrets: [],
			domains: [],
			volumes: []
		},
		autoDeploy: {
			enabled: false,
			lastPolledCommit: null,
			lastPolledAt: null,
			nextPollAt: null,
			lastPollError: null
		},
		internalDomain,
		defaultUrl: null,
		createdAt: '2026-06-17T12:00:00.000Z',
		updatedAt: '2026-06-17T12:00:00.000Z'
	};
}

describe('deriveServiceConnections', () => {
	test('creates a connection for exact internal-domain host references', () => {
		const connections = deriveServiceConnections([
			service('db', 'svc-db'),
			service('phpmyadmin', 'svc-phpmyadmin', [{ key: 'PMA_HOST', value: 'svc-db' }])
		]);

		expect(connections).toEqual([
			{
				id: 'service-connection:phpmyadmin:db',
				sourceServiceId: 'phpmyadmin',
				targetServiceId: 'db',
				envKeys: ['PMA_HOST']
			}
		]);
	});

	test('creates connections for URL, DSN, and host-port values', () => {
		const connections = deriveServiceConnections([
			service('db', 'svc-db'),
			service('cache', 'svc-cache'),
			service('api', 'svc-api', [
				{ key: 'DATABASE_DSN', value: 'postgres://user:pass@svc-db:5432/app' },
				{ key: 'CACHE_URL', value: 'redis://svc-cache:6379/0' },
				{ key: 'DB_HOST', value: 'svc-db:5432' }
			])
		]);

		expect(connections).toEqual([
			{
				id: 'service-connection:api:db',
				sourceServiceId: 'api',
				targetServiceId: 'db',
				envKeys: ['DATABASE_DSN', 'DB_HOST']
			},
			{
				id: 'service-connection:api:cache',
				sourceServiceId: 'api',
				targetServiceId: 'cache',
				envKeys: ['CACHE_URL']
			}
		]);
	});

	test('ignores non-reference environment keys', () => {
		const connections = deriveServiceConnections([
			service('db', 'svc-db'),
			service('api', 'svc-api', [
				{ key: 'MYSQL_PASSWORD', value: 'svc-db' },
				{ key: 'FEATURE_FLAG', value: 'postgres://svc-db:5432/app' }
			])
		]);

		expect(connections).toEqual([]);
	});

	test('ignores services without internal domains, self-links, partial matches, and duplicate references', () => {
		const connections = deriveServiceConnections([
			service('db', 'svc-db', [{ key: 'DB_HOST', value: 'svc-db' }]),
			service('db-backup', null),
			service('api', 'svc-api', [
				{ key: 'PRIMARY_HOST', value: 'svc-db' },
				{ key: 'PRIMARY_URL', value: 'postgres://svc-db:5432/app' },
				{ key: 'PRIMARY_HOST', value: 'svc-db' },
				{ key: 'BACKUP_HOST', value: 'svc-db-backup' }
			])
		]);

		expect(connections).toEqual([
			{
				id: 'service-connection:api:db',
				sourceServiceId: 'api',
				targetServiceId: 'db',
				envKeys: ['PRIMARY_HOST', 'PRIMARY_URL']
			}
		]);
	});
});
