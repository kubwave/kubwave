import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { DefaultDomainRuntime, DefaultDomainSettings, DockerImageServiceConfig, ServiceConfig } from '@kubwave/db';
import { decryptSecret, encryptSecret } from '@kubwave/crypto';

// @kubwave/db builds its (lazy) client on import; a URL is enough, nothing connects.
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/test';
const { referenceResolver } = await import('~/modules/worker/jobs/deployments/references');
const { secretsChecksum } = await import('~/modules/worker/jobs/deployments/deployers/runtime/secrets');
const { filesChecksum } = await import('~/modules/worker/jobs/deployments/deployers/runtime/config-files');

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

const API_ID = '11111111-2222-3333-4444-555555555555';
const DB_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const sslip: DefaultDomainSettings = { mode: 'sslip', base: null, subdomainTemplate: null };
const off: DefaultDomainSettings = { mode: 'off', base: null, subdomainTemplate: null };
const plainHttp: DefaultDomainRuntime = { ingressIp: '127.0.0.1', tls: false };
const tls: DefaultDomainRuntime = { ingressIp: '127.0.0.1', tls: true };
const sslipHttp = { settings: sslip, runtime: plainHttp };

function runtimeConfig(over: Partial<DockerImageServiceConfig> = {}): DockerImageServiceConfig {
	return { image: 'nginx', tag: 'latest', containerPort: 3000, env: [], domains: [], volumes: [], ...over };
}

const api = (over: Partial<DockerImageServiceConfig> = {}) => ({
	id: API_ID,
	name: 'api',
	type: 'docker-image' as const,
	config: runtimeConfig({ defaultDomainEnabled: true, ...over })
});
const postgres = {
	id: DB_ID,
	name: 'db',
	type: 'postgres' as const,
	config: { version: '16', storage: { size: '1Gi' }, password: 'x', env: [], domains: [], volumes: [], containerPort: null } as ServiceConfig
};

function envOf(value: string): ServiceConfig {
	return runtimeConfig({ env: [{ key: 'V', value }] });
}

function resolveEnv(value: string, targets = [api(), postgres], settings = sslip, runtime = plainHttp): string {
	return referenceResolver(targets, { settings, runtime })(envOf(value)).env[0]!.value;
}

describe('referenceResolver props', () => {
	test('host, port and internalUrl point at the internal Service', () => {
		expect(resolveEnv('${{ services.api.host }}')).toBe(`svc-${API_ID}`);
		expect(resolveEnv('${{ services.api.port }}')).toBe('3000');
		expect(resolveEnv('${{ services.api.internalUrl }}/v1')).toBe(`http://svc-${API_ID}:3000/v1`);
	});

	test('a database resolves to its engine port', () => {
		expect(resolveEnv('postgres://app:pw@${{ services.db.host }}:${{services.db.port}}/app')).toBe(`postgres://app:pw@svc-${DB_ID}:5432/app`);
	});

	test('domain/url use the generated default host, with the scheme from runtime TLS', () => {
		expect(resolveEnv('${{ services.api.domain }}')).toBe('api-11111111.127-0-0-1.sslip.io');
		expect(resolveEnv('${{ services.api.url }}')).toBe('http://api-11111111.127-0-0-1.sslip.io');
		expect(resolveEnv('${{ services.api.url }}', [api()], sslip, tls)).toBe('https://api-11111111.127-0-0-1.sslip.io');
	});

	test('the first custom domain wins over the default host', () => {
		const custom = api({ domains: [{ host: 'api.example.com', port: 3000 }] });
		expect(resolveEnv('${{ services.api.url }}/api/v1', [custom], sslip, tls)).toBe('https://api.example.com/api/v1');
	});

	test('non-reference ${{ … }} stays verbatim', () => {
		expect(resolveEnv('${{ secrets.GITHUB_TOKEN }}')).toBe('${{ secrets.GITHUB_TOKEN }}');
	});
});

describe('referenceResolver failures', () => {
	const failure =
		(value: string, targets = [api(), postgres], settings = sslip) =>
		() =>
			resolveEnv(value, targets, settings);

	test('unknown service', () => {
		expect(failure('${{ services.web.url }}')).toThrow('Cannot resolve ${{ services.web.url }} in env V: no service named "web" in this environment');
	});

	test('unknown property', () => {
		expect(failure('${{ services.api.hostname }}')).toThrow('unknown property "hostname"');
	});

	test('no container port', () => {
		expect(failure('${{ services.api.host }}', [api({ containerPort: null })])).toThrow('service "api" has no container port');
	});

	test('no public domain', () => {
		expect(failure('${{ services.api.url }}', [api({ defaultDomainEnabled: false })])).toThrow('service "api" has no public domain');
		expect(failure('${{ services.db.domain }}')).toThrow('service "db" has no public domain');
	});

	test('platform default domain off', () => {
		expect(failure('${{ services.api.url }}', [api()], off)).toThrow('service "api" has no custom domain and the platform default domain is off');
	});

	test('the message names the secret key but never its decrypted value', () => {
		const config = runtimeConfig({ secrets: [{ key: 'DB_URL', value: encryptSecret('postgres://app:hunter2@${{ services.nope.host }}/app') }] });
		const resolve = () => referenceResolver([api()], sslipHttp)(config);
		expect(resolve).toThrow('Cannot resolve ${{ services.nope.host }} in secret DB_URL: no service named "nope" in this environment');
		try {
			resolve();
		} catch (err) {
			expect((err as Error).message).not.toContain('hunter2');
		}
	});
});

describe('secrets and config files', () => {
	const withRefs = () =>
		runtimeConfig({
			secrets: [{ key: 'API', value: encryptSecret('${{ services.api.url }}') }],
			configFiles: [{ path: '/etc/app.conf', content: encryptSecret('upstream ${{ services.api.internalUrl }};') }]
		});

	test('resolve after decryption and stay encrypted', () => {
		const out = referenceResolver([api()], sslipHttp)(withRefs()) as DockerImageServiceConfig;
		expect(decryptSecret(out.secrets![0]!.value)).toBe('http://api-11111111.127-0-0-1.sslip.io');
		expect(decryptSecret(out.configFiles![0]!.content)).toBe(`upstream http://svc-${API_ID}:3000;`);
	});

	test('checksums change when a referenced value changes', () => {
		const config = withRefs();
		const before = referenceResolver([api()], sslipHttp)(config) as DockerImageServiceConfig;
		const custom = api({ domains: [{ host: 'api.example.com', port: 3000 }] });
		const after = referenceResolver([custom], sslipHttp)(config) as DockerImageServiceConfig;
		expect(secretsChecksum(after)).not.toBe(secretsChecksum(before));
		// The internalUrl in the file didn't move, so its checksum must not either.
		expect(filesChecksum(after)).toBe(filesChecksum(before));
		const newPort = referenceResolver([api({ containerPort: 8080 })], sslipHttp)(config) as DockerImageServiceConfig;
		expect(filesChecksum(newPort)).not.toBe(filesChecksum(before));
	});

	test('checksums are stable across re-encryption of the same value (no rollout every tick)', () => {
		const config = withRefs();
		const resolve = referenceResolver([api()], sslipHttp);
		const first = resolve(config) as DockerImageServiceConfig;
		const second = resolve(config) as DockerImageServiceConfig;
		expect(first.secrets![0]!.value).not.toBe(second.secrets![0]!.value);
		expect(secretsChecksum(first)).toBe(secretsChecksum(second));
		expect(filesChecksum(first)).toBe(filesChecksum(second));
	});
});
