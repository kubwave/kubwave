export interface RefMapping {
	namespace: { from: string; to: string };
	// base `svc-<id>` -> preview `svc-<id>`
	services: Map<string, string>;
	// base generated default-domain host -> preview generated default-domain host
	defaultDomains?: Map<string, string>;
}

// Rewrite base-env references to the preview's; service ids before namespace so neither corrupts the other; split/join is literal (no regex).
export function rewriteCrossRefs(value: string, mapping: RefMapping): string {
	let out = value;
	for (const [from, to] of mapping.services) {
		if (from !== to) out = out.split(from).join(to);
	}
	for (const [from, to] of mapping.defaultDomains ?? []) {
		if (from !== to) out = out.split(from).join(to);
	}
	if (mapping.namespace.from !== mapping.namespace.to) {
		out = out.split(mapping.namespace.from).join(mapping.namespace.to);
	}
	return out;
}
