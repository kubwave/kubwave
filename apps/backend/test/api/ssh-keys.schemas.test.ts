import { describe, expect, test } from 'bun:test';
import { createSshKeySchema } from '~/modules/teams/ssh-keys/ssh-keys.dto';

describe('createSshKeySchema', () => {
	test('accepts a generate request with just a name', () => {
		expect(createSshKeySchema.safeParse({ mode: 'generate', name: 'deploy' }).success).toBe(true);
	});

	test('accepts an upload request with a private key', () => {
		expect(createSshKeySchema.safeParse({ mode: 'upload', name: 'mine', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----' }).success).toBe(true);
	});

	test('rejects an upload request missing the private key', () => {
		expect(createSshKeySchema.safeParse({ mode: 'upload', name: 'mine' }).success).toBe(false);
	});

	test('rejects an unknown mode', () => {
		expect(createSshKeySchema.safeParse({ mode: 'import', name: 'x' }).success).toBe(false);
	});

	test('rejects a blank name', () => {
		expect(createSshKeySchema.safeParse({ mode: 'generate', name: '   ' }).success).toBe(false);
	});

	test('trims the name', () => {
		const result = createSshKeySchema.safeParse({ mode: 'generate', name: '  deploy  ' });
		expect(result.success && result.data.name).toBe('deploy');
	});
});
