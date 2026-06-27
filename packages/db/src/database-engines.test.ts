import { describe, expect, test } from 'bun:test';
import {
	buildDatabaseRuntimeConfig,
	databaseConnectionUri,
	databaseImageRef,
	DATABASE_ENGINES,
	defaultDatabaseVersion,
	isAllowedDatabaseVersion,
	isDatabaseEngine
} from './database-engines';
import type { DatabaseEngine, DatabaseServiceConfig } from './schema';

function config(overrides: Partial<DatabaseServiceConfig> = {}): DatabaseServiceConfig {
	return {
		version: '16',
		storage: { size: '2Gi' },
		password: 'v1:cipher',
		containerPort: null,
		env: [],
		domains: [],
		volumes: [],
		...overrides
	};
}

describe('database engine catalog', () => {
	test('exposes the four engines', () => {
		expect([...DATABASE_ENGINES]).toEqual(['postgres', 'mysql', 'mariadb', 'mongodb']);
	});

	test('isDatabaseEngine recognises engines and rejects other service types', () => {
		expect(isDatabaseEngine('postgres')).toBe(true);
		expect(isDatabaseEngine('mongodb')).toBe(true);
		expect(isDatabaseEngine('docker-image')).toBe(false);
		expect(isDatabaseEngine('redis')).toBe(false);
	});

	test('image ref combines image and version', () => {
		expect(databaseImageRef('postgres', '16')).toBe('postgres:16');
		expect(databaseImageRef('mongodb', '7')).toBe('mongo:7');
		expect(databaseImageRef('mariadb', '11.4')).toBe('mariadb:11.4');
	});

	test('version helpers track the curated list', () => {
		expect(defaultDatabaseVersion('postgres')).toBe('16');
		expect(isAllowedDatabaseVersion('postgres', '16')).toBe(true);
		expect(isAllowedDatabaseVersion('postgres', '8.4')).toBe(false);
		expect(isAllowedDatabaseVersion('mysql', '8.4')).toBe(true);
	});
});

describe('buildDatabaseRuntimeConfig', () => {
	test('postgres: init env, password secret, data volume, TCP probe, no domains/autoscaling', () => {
		const rc = buildDatabaseRuntimeConfig('postgres', config({ username: 'app', database: 'shop', storage: { size: '5Gi' } }));
		expect(rc.containerPort).toBe(5432);
		expect(rc.env).toContainEqual({ key: 'POSTGRES_USER', value: 'app' });
		expect(rc.env).toContainEqual({ key: 'POSTGRES_DB', value: 'shop' });
		// Postgres needs PGDATA pointed at a subdir of the mount.
		expect(rc.env).toContainEqual({ key: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' });
		expect(rc.secrets).toEqual([{ key: 'POSTGRES_PASSWORD', value: 'v1:cipher' }]);
		expect(rc.volumes).toEqual([{ name: 'data', mountPath: '/var/lib/postgresql/data', size: '5Gi' }]);
		expect(rc.healthCheck).toEqual({ enabled: true, type: 'tcp', port: 5432 });
		expect(rc.domains).toEqual([]);
		expect(rc.autoscaling).toBeUndefined();
	});

	test('defaults the username and database to "app" when blank', () => {
		const rc = buildDatabaseRuntimeConfig('postgres', config());
		expect(rc.env).toContainEqual({ key: 'POSTGRES_USER', value: 'app' });
		expect(rc.env).toContainEqual({ key: 'POSTGRES_DB', value: 'app' });
	});

	test('mysql writes the password to BOTH the root and app-user keys', () => {
		const rc = buildDatabaseRuntimeConfig('mysql', config({ version: '8.4' }));
		expect(rc.containerPort).toBe(3306);
		expect(rc.secrets).toEqual([
			{ key: 'MYSQL_ROOT_PASSWORD', value: 'v1:cipher' },
			{ key: 'MYSQL_PASSWORD', value: 'v1:cipher' }
		]);
	});

	test('mongodb uses the MONGO_INITDB_* env and data dir', () => {
		const rc = buildDatabaseRuntimeConfig('mongodb', config({ version: '7', username: 'root' }));
		expect(rc.containerPort).toBe(27017);
		expect(rc.env).toContainEqual({ key: 'MONGO_INITDB_ROOT_USERNAME', value: 'root' });
		expect(rc.secrets).toEqual([{ key: 'MONGO_INITDB_ROOT_PASSWORD', value: 'v1:cipher' }]);
		expect(rc.volumes[0]!.mountPath).toBe('/data/db');
	});

	test('appends user-supplied env and secrets after the generated credentials', () => {
		const rc = buildDatabaseRuntimeConfig('postgres', config({ env: [{ key: 'TZ', value: 'UTC' }], secrets: [{ key: 'EXTRA', value: 'v1:other' }] }));
		expect(rc.env).toContainEqual({ key: 'TZ', value: 'UTC' });
		expect(rc.secrets).toContainEqual({ key: 'EXTRA', value: 'v1:other' });
		expect(rc.secrets).toContainEqual({ key: 'POSTGRES_PASSWORD', value: 'v1:cipher' });
	});

	test('omits password secrets when no password is set (legacy/empty row)', () => {
		const rc = buildDatabaseRuntimeConfig('postgres', config({ password: '' }));
		expect(rc.secrets).toEqual([]);
	});
});

describe('databaseConnectionUri', () => {
	const args = { host: 'svc-1', port: 5432, username: 'app', database: 'shop' };

	test('postgres scheme', () => {
		expect(databaseConnectionUri({ engine: 'postgres', ...args, password: 'secret' })).toBe('postgresql://app:secret@svc-1:5432/shop');
	});

	test('mysql/mariadb use the mysql scheme', () => {
		expect(databaseConnectionUri({ engine: 'mariadb', ...args, port: 3306, password: 'secret' })).toBe('mysql://app:secret@svc-1:3306/shop');
	});

	test('mongodb appends authSource=admin', () => {
		expect(databaseConnectionUri({ engine: 'mongodb', ...args, port: 27017, password: 'secret' })).toBe(
			'mongodb://app:secret@svc-1:27017/shop?authSource=admin'
		);
	});

	test('URL-encodes credentials with special characters', () => {
		const uri = databaseConnectionUri({ engine: 'postgres', ...args, password: 'p@ss:w/rd' });
		expect(uri).toBe('postgresql://app:p%40ss%3Aw%2Frd@svc-1:5432/shop');
	});

	test.each([...DATABASE_ENGINES])('produces a parseable URL for %s', (engine: DatabaseEngine) => {
		const uri = databaseConnectionUri({ engine, ...args, password: 'secret' });
		expect(() => new URL(uri)).not.toThrow();
	});
});
