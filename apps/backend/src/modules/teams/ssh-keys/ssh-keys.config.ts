import {
	encryptSecret,
	generateSshKeyPair,
	parseSshPrivateKey,
	SshKeyEncryptedError,
	SshKeyParseError,
	SshKeyUnsupportedTypeError
} from '@kubwave/crypto';
import type { NewSshKey, SshKey } from '@kubwave/db';
import type { CreateSshKeyInput, SshKeyDto } from './ssh-keys.dto.js';
import { InvalidSshKeyError, SshKeyPassphraseError } from './ssh-keys.errors.js';

export function buildTeamSshKeyInsert(input: CreateSshKeyInput, teamId: string, actingUserId: string): NewSshKey {
	const material =
		input.mode === 'generate'
			? generateSshKeyPair()
			: (() => {
					try {
						return parseSshPrivateKey(input.privateKey);
					} catch (err) {
						if (err instanceof SshKeyEncryptedError) throw new SshKeyPassphraseError();
						if (err instanceof SshKeyParseError || err instanceof SshKeyUnsupportedTypeError) throw new InvalidSshKeyError();
						throw err;
					}
				})();

	return {
		scope: 'team',
		teamId,
		name: input.name.trim(),
		keyType: material.keyType,
		source: input.mode === 'generate' ? 'generated' : 'uploaded',
		publicKey: material.publicKey,
		privateKeyCiphertext: encryptSecret(material.privateKey),
		fingerprint: material.fingerprint,
		createdByUserId: actingUserId
	};
}

export function toSshKeyView(row: SshKey): SshKeyDto {
	return {
		id: row.id,
		scope: row.scope,
		teamId: row.teamId,
		name: row.name,
		keyType: row.keyType,
		source: row.source,
		publicKey: row.publicKey,
		fingerprint: row.fingerprint,
		createdByUserId: row.createdByUserId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}
