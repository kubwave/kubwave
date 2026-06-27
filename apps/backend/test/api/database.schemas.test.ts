import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret } from '@kubwave/crypto';
import type { DatabaseServiceConfig } from '@kubwave/db';
import { createServiceSchema, databaseUpdateConfigSchema, mysqlConfigSchema, postgresConfigSchema } from '~/modules/services/services.dto';
import { buildStoredDatabaseConfig, toConfigView } from '~/modules/services/services.config';

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

describe('database create config schemas', () => {
	test('postgres accepts a curated version and defaults storage to 1Gi', () => {
		const result = postgresConfigSchema.safeParse({ version: '16' });
		expect(result.success).toBe(true);
		expect(result.success && result.data.storage.size).toBe('1Gi');
	});

	test('rejects a version outside the engine list', () => {
		expect(postgresConfigSchema.safeParse({ version: '99' }).success).toBe(false);
		// 8.4 is a MySQL version, not a Postgres one.
		expect(postgresConfigSchema.safeParse({ version: '8.4' }).success).toBe(false);
		expect(mysqlConfigSchema.safeParse({ version: '8.4' }).success).toBe(true);
	});

	test('rejects an invalid database identifier', () => {
		expect(postgresConfigSchema.safeParse({ version: '16', database: '1-bad name' }).success).toBe(false);
		expect(postgresConfigSchema.safeParse({ version: '16', database: 'shop_db' }).success).toBe(true);
	});

	test('rejects an invalid storage quantity', () => {
		expect(postgresConfigSchema.safeParse({ version: '16', storage: { size: 'huge' } }).success).toBe(false);
	});
});

describe('createServiceSchema (database branches)', () => {
	test.each(['postgres', 'mysql', 'mariadb', 'mongodb'] as const)('accepts a %s service', engine => {
		const versionByEngine: Record<string, string> = { postgres: '16', mysql: '8.4', mariadb: '11.4', mongodb: '7' };
		const result = createServiceSchema.safeParse({ name: 'db', type: engine, config: { version: versionByEngine[engine] } });
		expect(result.success).toBe(true);
	});

	test('rejects a postgres service carrying a non-postgres version', () => {
		expect(createServiceSchema.safeParse({ name: 'db', type: 'postgres', config: { version: '8.4' } }).success).toBe(false);
	});
});

describe('databaseUpdateConfigSchema', () => {
	test('accepts a plain version string (engine re-checked in the service layer)', () => {
		const result = databaseUpdateConfigSchema.safeParse({ version: '16', storage: { size: '2Gi' } });
		expect(result.success).toBe(true);
		expect(result.success && result.data.env).toEqual([]);
	});
});

describe('buildStoredDatabaseConfig', () => {
	const input = { version: '16', storage: { size: '2Gi' }, username: 'app', database: 'shop', env: [], secrets: [] };

	test('on create, generates an encrypted password and fixes the engine port', () => {
		const stored = buildStoredDatabaseConfig('postgres', input, null);
		expect(stored.containerPort).toBe(5432);
		expect(stored.version).toBe('16');
		expect(stored.storage.size).toBe('2Gi');
		// Password is ciphertext that round-trips, never the plaintext.
		expect(stored.password).toMatch(/^v1:/);
		expect(typeof decryptSecret(stored.password)).toBe('string');
	});

	test('on update, preserves the existing password rather than regenerating', () => {
		const created = buildStoredDatabaseConfig('postgres', input, null);
		const updated = buildStoredDatabaseConfig(
			'postgres',
			{ ...input, storage: { size: '5Gi' } },
			{
				secrets: created.secrets,
				password: created.password
			}
		);
		expect(updated.password).toBe(created.password);
		expect(updated.storage.size).toBe('5Gi');
	});
});

describe('toConfigView (database)', () => {
	test('strips the generated password and masks user secrets', () => {
		const stored = buildStoredDatabaseConfig(
			'postgres',
			{ version: '16', storage: { size: '2Gi' }, env: [], secrets: [{ key: 'API_KEY', value: 'plain' }] },
			null
		) as DatabaseServiceConfig;
		const view = toConfigView(stored) as Record<string, unknown> & { secrets: Array<{ key: string; hasValue: boolean }> };
		expect('password' in view).toBe(false);
		expect(view.secrets).toContainEqual({ key: 'API_KEY', hasValue: true });
	});
});
