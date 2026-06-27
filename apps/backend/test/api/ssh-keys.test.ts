import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret, parseSshPrivateKey, generateSshKeyPair } from '@kubwave/crypto';
import type { SshKey } from '@kubwave/db';
import { buildTeamSshKeyInsert, toSshKeyView } from '~/modules/teams/ssh-keys/ssh-keys.config';
import { InvalidSshKeyError, SshKeyPassphraseError } from '~/modules/teams/ssh-keys/ssh-keys.errors';

beforeAll(() => {
	process.env.SECRETS_KEY = randomBytes(32).toString('base64url');
});

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// buildTeamSshKeyInsert turns a create request into the persisted row: generate/validate key material, encrypt the private key, never leave plaintext.
describe('buildTeamSshKeyInsert — generate', () => {
	test('produces a team-scoped ed25519 generated row', () => {
		const row = buildTeamSshKeyInsert({ mode: 'generate', name: 'deploy' }, TEAM_ID, USER_ID);
		expect(row.scope).toBe('team');
		expect(row.teamId).toBe(TEAM_ID);
		expect(row.keyType).toBe('ed25519');
		expect(row.source).toBe('generated');
		expect(row.createdByUserId).toBe(USER_ID);
		expect(row.publicKey.startsWith('ssh-ed25519 ')).toBe(true);
		expect(row.fingerprint.startsWith('SHA256:')).toBe(true);
	});

	test('stores the private key encrypted (decrypts to a usable OpenSSH key)', () => {
		const row = buildTeamSshKeyInsert({ mode: 'generate', name: 'deploy' }, TEAM_ID, USER_ID);
		expect(row.privateKeyCiphertext).not.toContain('BEGIN');
		const decrypted = decryptSecret(row.privateKeyCiphertext);
		expect(decrypted).toContain('BEGIN OPENSSH PRIVATE KEY');
		expect(parseSshPrivateKey(decrypted).publicKey).toBe(row.publicKey);
	});

	test('trims the name', () => {
		const row = buildTeamSshKeyInsert({ mode: 'generate', name: '  spaced  ' }, TEAM_ID, USER_ID);
		expect(row.name).toBe('spaced');
	});
});

describe('buildTeamSshKeyInsert — upload', () => {
	test('accepts a valid uploaded key and marks it uploaded', () => {
		const uploaded = generateSshKeyPair().privateKey; // stand-in for a user-supplied key
		const row = buildTeamSshKeyInsert({ mode: 'upload', name: 'mine', privateKey: uploaded }, TEAM_ID, USER_ID);
		expect(row.source).toBe('uploaded');
		expect(row.keyType).toBe('ed25519');
		expect(decryptSecret(row.privateKeyCiphertext)).toContain('BEGIN OPENSSH PRIVATE KEY');
	});

	test('rejects an unparseable key with InvalidSshKeyError (400)', () => {
		expect(() => buildTeamSshKeyInsert({ mode: 'upload', name: 'x', privateKey: 'garbage' }, TEAM_ID, USER_ID)).toThrow(InvalidSshKeyError);
	});

	test('rejects a passphrase-protected key with SshKeyPassphraseError (400)', () => {
		const { generateKeyPairSync } = require('node:crypto');
		const { privateKey: encrypted } = generateKeyPairSync('ed25519', {
			privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' },
			publicKeyEncoding: { type: 'spki', format: 'pem' }
		});
		expect(() => buildTeamSshKeyInsert({ mode: 'upload', name: 'x', privateKey: encrypted }, TEAM_ID, USER_ID)).toThrow(SshKeyPassphraseError);
	});
});

// The read view must never expose the private key ciphertext.
describe('toSshKeyView', () => {
	test('maps a row to a safe view without the private key', () => {
		const row: SshKey = {
			id: '33333333-3333-3333-3333-333333333333',
			scope: 'team',
			teamId: TEAM_ID,
			name: 'deploy',
			keyType: 'ed25519',
			source: 'generated',
			publicKey: 'ssh-ed25519 AAAA',
			privateKeyCiphertext: 'v1:secret:secret:secret',
			fingerprint: 'SHA256:abc',
			createdByUserId: USER_ID,
			createdAt: new Date('2026-06-13T00:00:00Z'),
			updatedAt: new Date('2026-06-13T00:00:00Z')
		};
		const view = toSshKeyView(row);
		expect(view).not.toHaveProperty('privateKeyCiphertext');
		expect(view.id).toBe(row.id);
		expect(view.name).toBe('deploy');
		expect(view.publicKey).toBe('ssh-ed25519 AAAA');
		expect(view.fingerprint).toBe('SHA256:abc');
		expect(view.createdAt).toBe('2026-06-13T00:00:00.000Z');
		expect(JSON.stringify(view)).not.toContain('v1:secret');
	});
});
