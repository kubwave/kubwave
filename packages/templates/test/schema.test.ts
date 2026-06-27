import { describe, expect, test } from 'bun:test';
import { templateSchema, CURRENT_SCHEMA_VERSION } from '../src/schema';

const valid = {
	id: 'uptime-kuma',
	name: 'Uptime Kuma',
	description: 'Monitoring tool.',
	category: 'monitoring',
	tags: ['monitoring'],
	logo: 'uptime-kuma.svg',
	documentation: 'https://github.com/louislam/uptime-kuma',
	schemaVersion: 1,
	version: 1,
	inputs: [],
	secrets: [],
	services: [
		{
			name: 'uptime-kuma',
			primary: true,
			type: 'docker-image',
			config: { image: 'louislam/uptime-kuma', tag: '1', containerPort: 3001, env: [], secrets: [], domains: [], volumes: [] }
		}
	]
};

describe('templateSchema', () => {
	test('CURRENT_SCHEMA_VERSION is 1', () => {
		expect(CURRENT_SCHEMA_VERSION).toBe(1);
	});
	test('accepts a valid single-service template', () => {
		expect(templateSchema.safeParse(valid).success).toBe(true);
	});
	test('rejects an id that is not kebab-case', () => {
		expect(templateSchema.safeParse({ ...valid, id: 'Uptime Kuma' }).success).toBe(false);
	});
	test('requires at least one service', () => {
		expect(templateSchema.safeParse({ ...valid, services: [] }).success).toBe(false);
	});

	test('accepts a jwt secret signed by another secret', () => {
		const t = {
			...valid,
			secrets: [
				{ key: 'jwt_secret', generate: 'password' },
				{ key: 'anon_key', generate: 'jwt', signWith: 'jwt_secret', claims: { role: 'anon', iss: 'supabase' } }
			]
		};
		expect(templateSchema.safeParse(t).success).toBe(true);
	});

	test('jwt secret defaults expiresInDays', () => {
		const t = {
			...valid,
			secrets: [
				{ key: 'jwt_secret', generate: 'password' },
				{ key: 'anon_key', generate: 'jwt', signWith: 'jwt_secret', claims: { role: 'anon' } }
			]
		};
		const parsed = templateSchema.parse(t);
		const jwt = parsed.secrets[1]!;
		expect(jwt.generate === 'jwt' && jwt.expiresInDays).toBe(3650);
	});

	test('rejects a jwt secret without signWith', () => {
		const t = { ...valid, secrets: [{ key: 'anon_key', generate: 'jwt', claims: { role: 'anon' } }] };
		expect(templateSchema.safeParse(t).success).toBe(false);
	});

	test('rejects a jwt secret without claims', () => {
		const t = { ...valid, secrets: [{ key: 'anon_key', generate: 'jwt', signWith: 'jwt_secret' }] };
		expect(templateSchema.safeParse(t).success).toBe(false);
	});

	test('accepts configFiles on a service config', () => {
		const svc = valid.services[0]!;
		const t = {
			...valid,
			services: [{ ...svc, config: { ...svc.config, configFiles: [{ path: '/etc/x.conf', content: 'a={{ inputs.foo }}' }] } }]
		};
		expect(templateSchema.safeParse(t).success).toBe(true);
	});

	test('configFiles defaults to an empty array', () => {
		const parsed = templateSchema.parse(valid);
		expect(parsed.services[0]!.config.configFiles).toEqual([]);
	});
});
