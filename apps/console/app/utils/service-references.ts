// Mirrors the backend's resolvable properties (apps/backend/src/shared/service-references.ts).
const REFERENCE_PROPS: ReadonlyArray<{ name: string; detail: string }> = [
	{ name: 'host', detail: 'internal hostname' },
	{ name: 'port', detail: 'container port' },
	{ name: 'internalUrl', detail: 'http://host:port' },
	{ name: 'domain', detail: 'public hostname' },
	{ name: 'url', detail: 'public URL' }
];

export interface ReferenceSuggestion {
	label: string;
	detail: string;
	insert: string;
}

// The reference being typed right before the caret: where its `${{` starts and what follows it.
export function referenceQueryBefore(textBeforeCaret: string): { start: number; query: string } | null {
	const match = /\$\{\{([^}\n]*)$/.exec(textBeforeCaret);
	return match ? { start: match.index, query: match[1]! } : null;
}

export function referenceSuggestions(serviceNames: string[], query: string): ReferenceSuggestion[] {
	const needle = query.trim().toLowerCase();
	return serviceNames
		.flatMap(name => REFERENCE_PROPS.map(prop => ({ label: `services.${name}.${prop.name}`, detail: prop.detail })))
		.filter(suggestion => suggestion.label.toLowerCase().includes(needle))
		.map(suggestion => ({ ...suggestion, insert: `\${{${suggestion.label}}}` }));
}

// Replaces the partial reference in [start, caret) with the chosen one, including closing braces typed (or auto-inserted) after the caret.
export function insertReference(text: string, start: number, caret: number, insert: string): { text: string; caret: number } {
	const end = text.startsWith('}}', caret) ? caret + 2 : caret;
	return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}
