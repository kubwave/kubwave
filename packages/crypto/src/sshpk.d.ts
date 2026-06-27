// Minimal local typings for sshpk. No @types/sshpk — that drags @types/node and poisons
// Bun-typed consumers (breaking Timer .unref()). This script-mode .d.ts is an ambient
// declaration; every consuming tsconfig (api, worker) must list this file in `include`.
declare module 'sshpk' {
	export interface Fingerprint {
		toString(): string;
	}

	export interface Key {
		readonly type: string;
		toString(format?: string): string;
		fingerprint(algorithm?: string): Fingerprint;
	}

	export interface PrivateKey extends Key {
		toPublic(): Key;
		toString(format?: string, options?: { passphrase?: string }): string;
	}

	export function generatePrivateKey(type: 'ed25519' | 'ecdsa', options?: { curve?: string }): PrivateKey;
	export function parsePrivateKey(data: string | Uint8Array, format?: string, options?: unknown): PrivateKey;

	const sshpk: {
		generatePrivateKey: typeof generatePrivateKey;
		parsePrivateKey: typeof parsePrivateKey;
	};
	export default sshpk;
}
