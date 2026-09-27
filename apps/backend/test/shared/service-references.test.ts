import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import type { DockerImageServiceConfig } from '@kubwave/db';
import { decryptSecret, encryptSecret } from '@kubwave/crypto';
import { invalidReferences, mapConfigValues, mapReferences, renameReferences } from '~/shared/service-references';
import { referenceIssues } from '~/modules/services/services.config';

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

const names = new Set(['api', 'my.db']);

describe('mapReferences', () => {
	test('parses name and prop with or without whitespace', () => {
		const seen: string[] = [];
		mapReferences('${{ services.api.url }} ${{services.api.host}}', (ref, token) => {
			seen.push(`${ref.name}|${ref.prop}|${token}`);
			return token;
		});
		expect(seen).toEqual(['api|url|${{ services.api.url }}', 'api|host|${{services.api.host}}']);
	});

	test('the prop is whatever follows the last dot, so names may contain dots', () => {
		expect(mapReferences('${{ services.my.db.port }}', ref => `${ref.name}:${ref.prop}`)).toBe('my.db:port');
	});

	test('leaves other ${{ … }} namespaces and plain {{ … }} verbatim', () => {
		const value = 'token=${{ secrets.GITHUB_TOKEN }} host={{ services.api.host }}';
		expect(mapReferences(value, () => 'X')).toBe(value);
	});
});

describe('invalidReferences', () => {
	test('accepts known names and props', () => {
		expect(invalidReferences('postgres://u:p@${{ services.my.db.host }}:${{ services.my.db.port }}/app', names)).toEqual([]);
	});

	test('rejects unknown services, unknown props and a missing prop', () => {
		expect(invalidReferences('${{ services.web.url }}', names)).toEqual(['${{ services.web.url }}: no service named "web" in this environment']);
		expect(invalidReferences('${{ services.api.URL }}', names)[0]).toContain('unknown property "URL"');
		expect(invalidReferences('${{ services.api }}', names)[0]).toContain('unknown property ""');
	});
});

describe('referenceIssues', () => {
	test('checks env, set secrets and config files, naming where each issue is', () => {
		const issues = referenceIssues(
			{
				env: [{ key: 'API_URL', value: '${{ services.nope.url }}' }],
				secrets: [
					{ key: 'KEEP', value: null },
					{ key: 'DB_URL', value: '${{ services.api.bogus }}' }
				],
				configFiles: [{ path: '/etc/app.conf', content: 'upstream ${{ services.gone.internalUrl }};' }]
			},
			names
		);
		expect(issues).toHaveLength(3);
		expect(issues[0]).toStartWith('env API_URL: ');
		expect(issues[1]).toStartWith('secret DB_URL: ');
		expect(issues[2]).toStartWith('config file /etc/app.conf: ');
	});
});

describe('renameReferences', () => {
	test('rewrites only references to the renamed service, in the canonical form without spaces', () => {
		expect(renameReferences('${{ services.api.url }}/v1 ${{ services.web.host }}', 'api', 'backend')).toBe(
			'${{services.backend.url}}/v1 ${{ services.web.host }}'
		);
	});
});

describe('mapConfigValues', () => {
	const config = (): DockerImageServiceConfig => ({
		image: 'nginx',
		tag: 'latest',
		containerPort: 80,
		env: [{ key: 'A', value: '${{ services.api.host }}' }],
		secrets: [
			{ key: 'S', value: encryptSecret('${{ services.api.host }}') },
			{ key: 'PLAIN', value: encryptSecret('literal') }
		],
		configFiles: [{ path: '/f', content: encryptSecret('no refs') }],
		domains: [],
		volumes: []
	});

	test('maps env, decrypted secrets and files; re-encrypts only what changed', () => {
		const input = config();
		const out = mapConfigValues(input, value => value.replace('${{ services.api.host }}', 'svc-1'));
		expect(out.env).toEqual([{ key: 'A', value: 'svc-1' }]);
		expect(decryptSecret(out.secrets![0]!.value)).toBe('svc-1');
		expect(out.secrets![1]!.value).toBe(input.secrets![1]!.value);
		expect(out.configFiles![0]!.content).toBe(input.configFiles![0]!.content);
	});

	test('returns the same object when nothing changed', () => {
		const input = config();
		expect(mapConfigValues(input, value => value)).toBe(input);
	});
});
