import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export {
	generateSshKeyPair,
	isSupportedSshKeyType,
	parseSshPrivateKey,
	SshKeyEncryptedError,
	SshKeyParseError,
	SshKeyUnsupportedTypeError,
	type SshKeyMaterial,
	type SshKeyType
} from './ssh';

// AES-256-GCM encryption for service secrets. Format: v1:<iv>:<tag>:<ct>.

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = 'v1';

let cachedKey: Buffer | null = null;

// SHA-256 derives a fixed 32-byte AES key, so any high-entropy SECRETS_KEY works regardless of length/encoding.
function getKey(): Buffer {
	if (cachedKey) return cachedKey;
	const raw = process.env.SECRETS_KEY;
	if (!raw) {
		throw new Error('SECRETS_KEY is not set — cannot encrypt/decrypt service secrets');
	}
	cachedKey = createHash('sha256').update(raw, 'utf8').digest();
	return cachedKey;
}

export function encryptSecret(plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, getKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptSecret(serialized: string): string {
	const parts = serialized.split(':');
	if (parts.length !== 4 || parts[0] !== VERSION) {
		throw new Error('Malformed secret ciphertext');
	}
	const [, ivB64, tagB64, ctB64] = parts;
	const iv = Buffer.from(ivB64!, 'base64url');
	const tag = Buffer.from(tagB64!, 'base64url');
	const ciphertext = Buffer.from(ctB64!, 'base64url');
	const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
	decipher.setAuthTag(tag);
	// GCM verifies the auth tag on final(); a tampered ciphertext/tag throws here.
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// base64url keeps generated passwords URL-safe so they survive env injection and connection-string interpolation without escaping.
export function generatePassword(bytes = 24): string {
	return randomBytes(bytes).toString('base64url');
}

// JWT base64url (RFC 7515): Node's 'base64url' encoding is the unpadded +→-, /→_ form JWS expects.
function base64UrlEncode(input: Buffer | string): string {
	return Buffer.from(input).toString('base64url');
}

export function signJwtHs256(payload: Record<string, unknown>, secret: string): string {
	const header = { alg: 'HS256', typ: 'JWT' };
	const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
	const signature = base64UrlEncode(createHmac('sha256', secret).update(signingInput).digest());
	return `${signingInput}.${signature}`;
}
