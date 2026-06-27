import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '@kubwave/crypto';
import { buildStoredConfig, toConfigView } from '~/modules/services/services.config';
import type { DockerImageConfigInput } from '~/modules/services/services.dto';
import type { DockerImageServiceConfig } from '@kubwave/db';

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

function dockerInput(configFiles: DockerImageConfigInput['configFiles']): DockerImageConfigInput {
	return {
		image: 'kong',
		tag: '3.9',
		containerPort: 8000,
		env: [],
		secrets: [],
		domains: [],
		volumes: [],
		configFiles
	} as DockerImageConfigInput;
}

// Rendered config files carry credentials (kong.yml holds the service_role key), so content must be
// stored as ciphertext — never plaintext in the DB config JSON.
describe('buildStoredConfig config files', () => {
	test('encrypts file content (round-trips, never stores plaintext)', () => {
		const stored = buildStoredConfig(dockerInput([{ path: '/home/kong/kong.yml', content: '_format_version: "3.0"' }]), undefined);
		expect(stored.configFiles).toHaveLength(1);
		expect(stored.configFiles![0]!.path).toBe('/home/kong/kong.yml');
		expect(stored.configFiles![0]!.content).not.toBe('_format_version: "3.0"');
		expect(decryptSecret(stored.configFiles![0]!.content)).toBe('_format_version: "3.0"');
	});

	test('omits configFiles when none are provided', () => {
		const stored = buildStoredConfig(dockerInput([]), undefined);
		expect(stored.configFiles).toBeUndefined();
	});
});

// Config-file content is shown in the console (decrypted) so users can read/author their own configs.
describe('toConfigView config files', () => {
	test('exposes configFiles with decrypted content', () => {
		const stored: DockerImageServiceConfig = {
			image: 'kong',
			tag: '3.9',
			containerPort: 8000,
			env: [],
			domains: [],
			volumes: [],
			configFiles: [{ path: '/home/kong/kong.yml', content: encryptSecret('hello: world') }]
		};
		const view = toConfigView(stored) as { configFiles?: Array<{ path: string; content: string }> };
		expect(view.configFiles).toEqual([{ path: '/home/kong/kong.yml', content: 'hello: world' }]);
	});
});
