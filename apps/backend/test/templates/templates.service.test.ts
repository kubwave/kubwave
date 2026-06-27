process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/test';

import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import type { CatalogTemplate } from '@kubwave/templates';
import type { ServicesService } from '~/modules/services/services.service';
import type { TemplateCatalogService } from '~/modules/templates/template-catalog.service';

const { TemplatesService } = await import('~/modules/templates/templates.service');

const ghost: CatalogTemplate = {
	id: 'ghost',
	name: 'Ghost',
	description: 'Blog',
	category: 'cms',
	tags: [],
	logo: 'ghost.svg',
	logoSvg: '<svg/>',
	documentation: 'https://ghost.org',
	schemaVersion: 1,
	version: 1,
	inputs: [{ key: 'url', label: 'URL', type: 'string', required: true }],
	secrets: [{ key: 'db_password', generate: 'password' }],
	services: [
		{
			name: 'db',
			primary: false,
			type: 'docker-image',
			config: {
				image: 'mysql',
				tag: '8.4',
				containerPort: 3306,
				env: [],
				secrets: [{ key: 'MYSQL_PASSWORD', value: '{{ secrets.db_password }}' }],
				domains: [],
				volumes: [{ name: 'data', mountPath: '/var/lib/mysql', size: '1Gi' }],
				configFiles: []
			}
		},
		{
			name: 'ghost',
			primary: true,
			type: 'docker-image',
			config: {
				image: 'ghost',
				tag: '5',
				containerPort: 2368,
				defaultDomainEnabled: true,
				env: [
					{ key: 'database__connection__host', value: '{{ services.db.host }}' },
					{ key: 'url', value: '{{ inputs.url }}' }
				],
				secrets: [{ key: 'database__connection__password', value: '{{ secrets.db_password }}' }],
				domains: [],
				volumes: [],
				configFiles: []
			}
		}
	]
};

function makeService(template: CatalogTemplate | null, existingNames: string[] = []) {
	const created: Array<{ name: string; config: Record<string, unknown>; id: string }> = [];
	let counter = 0;
	const services = {
		listServicesForEnvironment: async () => existingNames.map(name => ({ name })),
		createService: async (_u: string, _e: string, input: { name: string; config: Record<string, unknown> }, id?: string) => {
			counter += 1;
			const serviceId = id ?? `id-${counter}`;
			created.push({ name: input.name, config: input.config, id: serviceId });
			return { id: serviceId, name: input.name };
		}
	} as unknown as ServicesService;
	const catalog = { getTemplate: async () => template } as unknown as TemplateCatalogService;
	return { svc: new TemplatesService(catalog, services), created };
}

describe('TemplatesService.instantiate', () => {
	test('creates the db first, then ghost wired to svc-<dbId> with the shared password', async () => {
		const { svc, created } = makeService(ghost);
		await svc.instantiate('u', 'env', 'ghost', 'myblog', { url: 'https://blog.test' });
		expect(created.map(c => c.name)).toEqual(['myblog-db', 'myblog']);
		const ghostEnv = created[1]!.config.env as Array<{ key: string; value: string }>;
		expect(ghostEnv.find(e => e.key === 'database__connection__host')!.value).toBe(`svc-${created[0]!.id}`);
		expect(ghostEnv.find(e => e.key === 'url')!.value).toBe('https://blog.test');
		const dbSecret = (created[0]!.config.secrets as Array<{ key: string; value: string }>).find(s => s.key === 'MYSQL_PASSWORD')!.value;
		const ghostSecret = (created[1]!.config.secrets as Array<{ key: string; value: string }>).find(
			s => s.key === 'database__connection__password'
		)!.value;
		expect(dbSecret).toBe(ghostSecret);
		expect(dbSecret.length).toBeGreaterThan(0);
	});

	test('resolves cyclic service references (a <-> b) via pre-generated hosts', async () => {
		const cyclic: CatalogTemplate = {
			id: 'cyc',
			name: 'Cyc',
			description: 'x',
			category: 'test',
			tags: [],
			logo: 'x.svg',
			logoSvg: '<svg/>',
			documentation: 'https://example.com',
			schemaVersion: 1,
			version: 1,
			inputs: [],
			secrets: [],
			services: [
				{
					name: 'a',
					primary: true,
					type: 'docker-image',
					config: {
						image: 'a',
						tag: '1',
						containerPort: 80,
						env: [{ key: 'B_HOST', value: '{{ services.b.host }}' }],
						secrets: [],
						domains: [],
						volumes: [],
						configFiles: []
					}
				},
				{
					name: 'b',
					primary: false,
					type: 'docker-image',
					config: {
						image: 'b',
						tag: '1',
						containerPort: 80,
						env: [{ key: 'A_HOST', value: '{{ services.a.host }}' }],
						secrets: [],
						domains: [],
						volumes: [],
						configFiles: []
					}
				}
			]
		};
		const { svc, created } = makeService(cyclic);
		await svc.instantiate('u', 'env', 'cyc', 'app', {});
		// a (created first) references b (declared later); b references a — both resolve to pre-generated hosts.
		const aEnv = created[0]!.config.env as Array<{ key: string; value: string }>;
		const bEnv = created[1]!.config.env as Array<{ key: string; value: string }>;
		expect(aEnv.find(e => e.key === 'B_HOST')!.value).toBe(`svc-${created[1]!.id}`);
		expect(bEnv.find(e => e.key === 'A_HOST')!.value).toBe(`svc-${created[0]!.id}`);
	});

	test('threads command/args through instantiate (edge-runtime shape)', async () => {
		const cmdTmpl: CatalogTemplate = {
			id: 'fns',
			name: 'Fns',
			description: 'x',
			category: 'test',
			tags: [],
			logo: 'x.svg',
			logoSvg: '<svg/>',
			documentation: 'https://example.com',
			schemaVersion: 1,
			version: 1,
			inputs: [],
			secrets: [],
			services: [
				{
					name: 'functions',
					primary: true,
					type: 'docker-image',
					config: {
						image: 'supabase/edge-runtime',
						tag: 'v1.71.2',
						containerPort: 9000,
						env: [],
						secrets: [],
						domains: [],
						volumes: [],
						configFiles: [],
						command: ['start', '--main-service', '/home/deno/functions/main'],
						args: ['--verbose']
					}
				}
			]
		};
		const { svc, created } = makeService(cmdTmpl);
		await svc.instantiate('u', 'env', 'fns', 'app', {});
		const cfg = created[0]!.config as { command?: string[]; args?: string[] };
		expect(cfg.command).toEqual(['start', '--main-service', '/home/deno/functions/main']);
		expect(cfg.args).toEqual(['--verbose']);
	});

	test('mints a jwt secret signed with an earlier secret', async () => {
		const tmpl: CatalogTemplate = {
			id: 'sb',
			name: 'SB',
			description: 'x',
			category: 'baas',
			tags: [],
			logo: 'sb.svg',
			logoSvg: '<svg/>',
			documentation: 'https://supabase.com',
			schemaVersion: 1,
			version: 1,
			inputs: [],
			secrets: [
				{ key: 'jwt_secret', generate: 'password' },
				{ key: 'anon_key', generate: 'jwt', signWith: 'jwt_secret', claims: { role: 'anon', iss: 'supabase' }, expiresInDays: 3650 }
			],
			services: [
				{
					name: 'app',
					primary: true,
					type: 'docker-image',
					config: {
						image: 'img',
						tag: '1',
						containerPort: 8000,
						env: [
							{ key: 'ANON_KEY', value: '{{ secrets.anon_key }}' },
							{ key: 'JWT_SECRET', value: '{{ secrets.jwt_secret }}' }
						],
						secrets: [],
						domains: [],
						volumes: [],
						configFiles: []
					}
				}
			]
		};
		const { svc, created } = makeService(tmpl);
		await svc.instantiate('u', 'env', 'sb', 'sb', {});
		const env = created[0]!.config.env as Array<{ key: string; value: string }>;
		const token = env.find(e => e.key === 'ANON_KEY')!.value;
		const jwtSecret = env.find(e => e.key === 'JWT_SECRET')!.value;

		const parts = token.split('.');
		expect(parts).toHaveLength(3);
		const [header, payload, signature] = parts as [string, string, string];
		const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		expect(claims.role).toBe('anon');
		expect(claims.iss).toBe('supabase');
		expect(typeof claims.iat).toBe('number');
		expect(claims.exp).toBeGreaterThan(claims.iat);
		// Signature verifies against the generated jwt_secret value.
		const expected = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
		expect(signature).toBe(expected);
	});

	test('rejects an unknown template', async () => {
		const { svc } = makeService(null);
		await expect(svc.instantiate('u', 'env', 'nope', undefined, {})).rejects.toThrow();
	});

	test('rejects a missing required input', async () => {
		const { svc } = makeService(ghost);
		await expect(svc.instantiate('u', 'env', 'ghost', 'myblog', {})).rejects.toThrow();
	});

	test('rejects when a derived name already exists', async () => {
		const { svc } = makeService(ghost, ['myblog-db']);
		await expect(svc.instantiate('u', 'env', 'ghost', 'myblog', { url: 'https://blog.test' })).rejects.toThrow();
	});

	test('rejects an input value longer than 2000 chars and creates zero services', async () => {
		const { svc, created } = makeService(ghost);
		await expect(svc.instantiate('u', 'env', 'ghost', 'myblog', { url: 'x'.repeat(3000) })).rejects.toThrow();
		expect(created).toHaveLength(0);
	});

	test('rejects intra-batch name collision and creates zero services', async () => {
		const collidingTemplate: CatalogTemplate = {
			id: 'collide',
			name: 'Collide',
			description: 'Test',
			category: 'test',
			tags: [],
			logo: 'x.svg',
			logoSvg: '<svg/>',
			documentation: 'https://example.com',
			schemaVersion: 1,
			version: 1,
			inputs: [],
			secrets: [],
			services: [
				{
					name: 'app',
					primary: false,
					type: 'docker-image',
					config: { image: 'img', tag: 'latest', containerPort: 80, env: [], secrets: [], domains: [], volumes: [], configFiles: [] }
				},
				{
					name: 'app',
					primary: false,
					type: 'docker-image',
					config: { image: 'img', tag: 'latest', containerPort: 80, env: [], secrets: [], domains: [], volumes: [], configFiles: [] }
				}
			]
		};
		const { svc, created } = makeService(collidingTemplate);
		await expect(svc.instantiate('u', 'env', 'collide', 'myapp', {})).rejects.toThrow();
		expect(created).toHaveLength(0);
	});
});
