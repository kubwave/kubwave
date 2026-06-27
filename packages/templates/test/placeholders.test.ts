import { describe, expect, test } from 'bun:test';
import { findPlaceholders, validateTemplateReferences } from '../src/placeholders';
import type { Template } from '../src/schema';

function ghostLike(overrides: Partial<Template['services'][number]['config']> = {}): Template {
	return {
		id: 'ghost',
		name: 'Ghost',
		description: 'Blog',
		category: 'cms',
		tags: [],
		logo: 'ghost.svg',
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
					volumes: [],
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
					env: [
						{ key: 'database__connection__host', value: '{{ services.db.host }}' },
						{ key: 'url', value: '{{ inputs.url }}' }
					],
					secrets: [{ key: 'database__connection__password', value: '{{ secrets.db_password }}' }],
					domains: [],
					volumes: [],
					configFiles: [],
					...overrides
				}
			}
		]
	};
}

describe('findPlaceholders', () => {
	test('parses ns.key and ns.key.sub', () => {
		expect(findPlaceholders('{{ secrets.db_password }} and {{ services.db.host }}')).toEqual([
			{ ns: 'secrets', key: 'db_password' },
			{ ns: 'services', key: 'db', sub: 'host' }
		]);
	});
});

describe('validateTemplateReferences', () => {
	test('valid ghost template has no errors', () => {
		expect(validateTemplateReferences(ghostLike())).toEqual([]);
	});
	test('flags an undeclared secret', () => {
		const t = ghostLike();
		t.services[1]!.config.secrets[0]!.value = '{{ secrets.unknown }}';
		expect(validateTemplateReferences(t)).toContain('service "ghost": unknown secret reference "unknown"');
	});
	test('allows a forward / cyclic service reference (hosts resolve order-independently)', () => {
		const t = ghostLike();
		// db references ghost (declared later); ghost already references db -> a cycle. Both are valid now.
		t.services[0]!.config.env.push({ key: 'X', value: '{{ services.ghost.host }}' });
		expect(validateTemplateReferences(t)).toEqual([]);
	});
	test('flags an unknown service reference', () => {
		const t = ghostLike();
		t.services[0]!.config.env.push({ key: 'X', value: '{{ services.nope.host }}' });
		expect(validateTemplateReferences(t)).toContain('service "db": unknown service reference "nope"');
	});

	test('accepts a jwt secret signed by an earlier secret', () => {
		const t = ghostLike();
		t.secrets = [
			{ key: 'db_password', generate: 'password' },
			{ key: 'jwt_secret', generate: 'password' },
			{ key: 'anon_key', generate: 'jwt', signWith: 'jwt_secret', claims: { role: 'anon' }, expiresInDays: 3650 }
		];
		expect(validateTemplateReferences(t)).toEqual([]);
	});

	test('flags a jwt secret signing with a later secret', () => {
		const t = ghostLike();
		t.secrets = [
			{ key: 'db_password', generate: 'password' },
			{ key: 'anon_key', generate: 'jwt', signWith: 'jwt_secret', claims: { role: 'anon' }, expiresInDays: 3650 },
			{ key: 'jwt_secret', generate: 'password' }
		];
		expect(validateTemplateReferences(t)).toContain('secret "anon_key": signWith "jwt_secret" must reference an earlier secret');
	});

	test('flags a jwt secret signing with an unknown secret', () => {
		const t = ghostLike();
		t.secrets = [
			{ key: 'db_password', generate: 'password' },
			{ key: 'anon_key', generate: 'jwt', signWith: 'nope', claims: { role: 'anon' }, expiresInDays: 3650 }
		];
		expect(validateTemplateReferences(t)).toContain('secret "anon_key": signWith "nope" must reference an earlier secret');
	});

	test('validates placeholders inside config-file content', () => {
		const t = ghostLike();
		t.services[1]!.config.configFiles = [{ path: '/etc/x', content: '{{ secrets.unknown }}' }];
		expect(validateTemplateReferences(t)).toContain('service "ghost": unknown secret reference "unknown"');
	});
});
