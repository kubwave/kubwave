import { describe, expect, test } from 'bun:test';
import { resolveTemplateServiceConfig, resolveTemplateString } from '~/modules/templates/template-placeholder';

const ctx = { secrets: { db_password: 'pw123' }, inputs: { url: 'https://blog.test' }, services: { db: { host: 'svc-abc' } } };

describe('resolveTemplateString', () => {
	test('resolves all three namespaces', () => {
		expect(resolveTemplateString('{{ secrets.db_password }}', ctx)).toBe('pw123');
		expect(resolveTemplateString('{{ inputs.url }}', ctx)).toBe('https://blog.test');
		expect(resolveTemplateString('{{ services.db.host }}', ctx)).toBe('svc-abc');
	});
	test('throws on unknown reference', () => {
		expect(() => resolveTemplateString('{{ secrets.nope }}', ctx)).toThrow();
	});
});

describe('resolveTemplateServiceConfig', () => {
	test('resolves env, secrets and domains', () => {
		const config = {
			image: 'ghost',
			tag: '5',
			containerPort: 2368,
			defaultDomainEnabled: true,
			env: [{ key: 'host', value: '{{ services.db.host }}' }],
			secrets: [{ key: 'pw', value: '{{ secrets.db_password }}' }],
			domains: [],
			volumes: [],
			configFiles: []
		};
		const out = resolveTemplateServiceConfig(config, ctx);
		expect(out.env[0]).toEqual({ key: 'host', value: 'svc-abc' });
		expect(out.secrets[0]).toEqual({ key: 'pw', value: 'pw123' });
	});

	test('resolves placeholders in config-file content', () => {
		const config = {
			image: 'kong',
			tag: '3.9',
			containerPort: 8000,
			env: [],
			secrets: [],
			domains: [],
			volumes: [],
			configFiles: [{ path: '/home/kong/kong.yml', content: 'key: {{ secrets.db_password }} host: {{ services.db.host }}' }]
		};
		const out = resolveTemplateServiceConfig(config, ctx);
		expect(out.configFiles[0]).toEqual({ path: '/home/kong/kong.yml', content: 'key: pw123 host: svc-abc' });
	});
});
