import sshpk, { type PrivateKey } from 'sshpk';

// Generate (ed25519) and parse/validate uploaded SSH keys, shared by api and worker.

export type SshKeyType = 'ed25519' | 'rsa' | 'ecdsa';

const SUPPORTED_TYPES: readonly SshKeyType[] = ['ed25519', 'rsa', 'ecdsa'];

export function isSupportedSshKeyType(type: string): type is SshKeyType {
	return (SUPPORTED_TYPES as readonly string[]).includes(type);
}

export interface SshKeyMaterial {
	keyType: SshKeyType;
	// OpenSSH single-line public key, comment stripped: "<type> <base64>".
	publicKey: string;
	// OpenSSH-format private key (passphrase-free), usable as a `ssh -i` deploy key.
	privateKey: string;
	// OpenSSH SHA256 fingerprint, e.g. "SHA256:abc…".
	fingerprint: string;
}

export class SshKeyParseError extends Error {
	constructor(message = 'Could not parse SSH private key') {
		super(message);
		this.name = 'SshKeyParseError';
	}
}

export class SshKeyEncryptedError extends Error {
	constructor(message = 'SSH private key is passphrase-protected') {
		super(message);
		this.name = 'SshKeyEncryptedError';
	}
}

export class SshKeyUnsupportedTypeError extends Error {
	constructor(type: string) {
		super(`Unsupported SSH key type: ${type}`);
		this.name = 'SshKeyUnsupportedTypeError';
	}
}

// Drop the optional trailing comment field so two encodings of the same key compare equal.
function toPublicLine(key: PrivateKey): string {
	return key.toPublic().toString('ssh').split(' ').slice(0, 2).join(' ');
}

function toMaterial(key: PrivateKey): SshKeyMaterial {
	if (!isSupportedSshKeyType(key.type)) {
		throw new SshKeyUnsupportedTypeError(key.type);
	}
	return {
		keyType: key.type as SshKeyType,
		publicKey: toPublicLine(key),
		privateKey: key.toString('openssh'),
		fingerprint: key.fingerprint('sha256').toString()
	};
}

export function generateSshKeyPair(): SshKeyMaterial {
	return toMaterial(sshpk.generatePrivateKey('ed25519'));
}

export function parseSshPrivateKey(input: string): SshKeyMaterial {
	let key: PrivateKey;
	try {
		key = sshpk.parsePrivateKey(input, 'auto');
	} catch (err) {
		// sshpk throws KeyEncryptedError for passphrase-protected keys; everything else is a parse error.
		if (err instanceof Error && err.name === 'KeyEncryptedError') {
			throw new SshKeyEncryptedError();
		}
		throw new SshKeyParseError(err instanceof Error ? err.message : undefined);
	}
	return toMaterial(key);
}
