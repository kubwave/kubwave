import { createCipheriv, createDecipheriv, createHash, createHmac, createSign, randomBytes, timingSafeEqual } from 'node:crypto';

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

// GitHub App auth JWT; GitHub caps exp at 10 min and the caller sets iat/exp/iss in `payload`.
export function signJwtRs256(payload: Record<string, unknown>, privateKeyPem: string): string {
	const header = { alg: 'RS256', typ: 'JWT' };
	const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
	const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKeyPem).toString('base64url');
	return `${signingInput}.${signature}`;
}

// Verify a GitHub webhook's X-Hub-Signature-256 header ("sha256=<hex>") against the RAW request body.
// Constant-time; returns false on any missing/malformed/mismatched input (never throws) so a bad signature is always a clean reject.
export function verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined | null, secret: string): boolean {
	if (!signatureHeader) return false;
	const [scheme, provided] = signatureHeader.split('=');
	if (scheme !== 'sha256' || !provided) return false;
	const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
	const providedBuf = Buffer.from(provided, 'utf8');
	const expectedBuf = Buffer.from(expected, 'utf8');
	// timingSafeEqual throws on length mismatch — guard first, and an unequal length is already a mismatch.
	if (providedBuf.length !== expectedBuf.length) return false;
	return timingSafeEqual(providedBuf, expectedBuf);
}
