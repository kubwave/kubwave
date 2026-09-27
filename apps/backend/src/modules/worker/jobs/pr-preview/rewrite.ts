export interface RefMapping {
	namespace: { from: string; to: string };
	// base `svc-<id>` -> preview `svc-<id>`
	services: Map<string, string>;
	// base public host (custom or generated default) -> preview generated default-domain host
	hosts?: Map<string, string>;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Rewrite base-env references to the preview's; service ids before namespace so neither corrupts the other; ids/namespace are literal split/join.
// Hosts match on label boundaries so `example.com` never rewrites inside `api.example.com`, `example.com.au` or a `noreply@example.com` sender.
export function rewriteCrossRefs(value: string, mapping: RefMapping): string {
	let out = value;
	for (const [from, to] of mapping.services) {
		if (from !== to) out = out.split(from).join(to);
	}
	for (const [from, to] of mapping.hosts ?? []) {
		if (from !== to) out = out.replace(new RegExp(`(?<![\\w.@-])${escapeRegExp(from)}(?![\\w.-])`, 'gi'), () => to);
	}
	if (mapping.namespace.from !== mapping.namespace.to) {
		out = out.split(mapping.namespace.from).join(mapping.namespace.to);
	}
	return out;
}
