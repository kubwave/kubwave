import type { RuntimeConfig } from '@kubwave/db';
import { decryptSecret, encryptSecret } from '@kubwave/crypto';

// `${{services.<name>.<prop>}}`; whitespace inside the braces is tolerated. The `$` keeps these apart from template
// `{{ ns.key }}` placeholders, which resolve once at instantiation.
const REFERENCE_RE = /\$\{\{\s*(.*?)\s*\}\}/g;
const NAMESPACE = 'services.';

export const REFERENCE_PROPS = ['host', 'port', 'internalUrl', 'domain', 'url'] as const;
export type ReferenceProp = (typeof REFERENCE_PROPS)[number];

export interface ServiceReference {
	name: string;
	prop: string;
}

export function isReferenceProp(prop: string): prop is ReferenceProp {
	return (REFERENCE_PROPS as readonly string[]).includes(prop);
}

// Service names may contain dots, so the prop is whatever follows the last one.
function parseReference(expr: string): ServiceReference | null {
	if (!expr.startsWith(NAMESPACE)) return null;
	const rest = expr.slice(NAMESPACE.length);
	const dot = rest.lastIndexOf('.');
	return dot < 0 ? { name: rest, prop: '' } : { name: rest.slice(0, dot), prop: rest.slice(dot + 1) };
}

// Only the `services.` namespace is ours; any other `${{ … }}` (e.g. GitHub Actions syntax in a config file) stays verbatim.
export function mapReferences(text: string, fn: (ref: ServiceReference, token: string) => string): string {
	return text.replace(REFERENCE_RE, (token, expr: string) => {
		const ref = parseReference(expr);
		return ref ? fn(ref, token) : token;
	});
}

export function invalidReferences(text: string, names: ReadonlySet<string>): string[] {
	const issues: string[] = [];
	mapReferences(text, (ref, token) => {
		if (!names.has(ref.name)) issues.push(`${token}: no service named "${ref.name}" in this environment`);
		else if (!isReferenceProp(ref.prop)) issues.push(`${token}: unknown property "${ref.prop}" (use ${REFERENCE_PROPS.join(', ')})`);
		return token;
	});
	return issues;
}

export function renameReferences(text: string, from: string, to: string): string {
	return mapReferences(text, (ref, token) => (ref.name === from ? `\${{services.${to}.${ref.prop}}}` : token));
}

// Applies mapValue to every value a reference may live in; ciphertext is decrypted for it and re-encrypted only when it changed.
// Returns the same object when nothing changed, so callers can skip writes.
export function mapConfigValues<T extends RuntimeConfig>(config: T, mapValue: (value: string, location: string) => string): T {
	let changed = false;
	const mapPlaintext = (value: string, location: string): string => {
		const next = mapValue(value, location);
		if (next !== value) changed = true;
		return next;
	};
	const mapCiphertext = (ciphertext: string, location: string): string => {
		const value = decryptSecret(ciphertext);
		const next = mapValue(value, location);
		if (next === value) return ciphertext;
		changed = true;
		return encryptSecret(next);
	};
	const next: T = {
		...config,
		env: config.env.map(e => ({ key: e.key, value: mapPlaintext(e.value, `env ${e.key}`) })),
		...(config.secrets ? { secrets: config.secrets.map(s => ({ key: s.key, value: mapCiphertext(s.value, `secret ${s.key}`) })) } : {}),
		...(config.configFiles
			? { configFiles: config.configFiles.map(f => ({ path: f.path, content: mapCiphertext(f.content, `config file ${f.path}`) })) }
			: {})
	};
	return changed ? next : config;
}
