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

type PreviewService = {
	name: string;
	internalDomain: string | null;
	config: { containerPort: number | null; domains?: Array<{ host: string }> };
	defaultUrl: string | null;
};

// What a value will look like at runtime, for the editor's preview. Unknown or unresolvable
// references stay as written; the backend is the source of truth when it deploys.
export function previewReferences(value: string, services: PreviewService[]): string {
	return value.replace(/\$\{\{\s*services\.(.+?)\.([^.\s}]+)\s*\}\}/g, (match, name: string, property: string) => {
		const service = services.find(candidate => candidate.name === name);
		if (!service?.internalDomain) return match;
		const port = service.config.containerPort;
		const internalUrl = `http://${service.internalDomain}${port ? `:${port}` : ''}`;
		const publicHost =
			service.config.domains?.[0]?.host ?? (service.defaultUrl && URL.canParse(service.defaultUrl) ? new URL(service.defaultUrl).host : null);
		const resolved: Record<string, string | null> = {
			host: service.internalDomain,
			port: port ? String(port) : null,
			internalUrl,
			domain: publicHost,
			url: publicHost ? `https://${publicHost}` : null
		};
		return Object.hasOwn(resolved, property) ? (resolved[property] ?? match) : match;
	});
}
