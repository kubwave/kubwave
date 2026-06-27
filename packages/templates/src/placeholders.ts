import type { Template } from './schema';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z]+)\.([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\s*\}\}/g;

export interface Placeholder {
	ns: string;
	key: string;
	sub?: string;
}

export function findPlaceholders(value: string): Placeholder[] {
	const out: Placeholder[] = [];
	for (const match of value.matchAll(PLACEHOLDER_RE)) {
		const ns = match[1]!;
		const key = match[2]!;
		const sub = match[3];
		out.push(sub ? { ns, key, sub } : { ns, key });
	}
	return out;
}

function configStrings(config: Template['services'][number]['config']): string[] {
	return [
		...config.env.map(e => e.value),
		...config.secrets.map(s => s.value),
		...config.domains.map(d => d.host),
		...config.configFiles.map(f => f.content)
	];
}

export function validateTemplateReferences(template: Template): string[] {
	const errors: string[] = [];
	const inputKeys = new Set(template.inputs.map(i => i.key));
	const secretKeys = new Set(template.secrets.map(s => s.key));
	// Service IDs are pre-generated for all services before config resolves, so a reference may point at any service regardless of order (cycles included).
	const serviceNames = new Set(template.services.map(s => s.name));
	const primaries = template.services.filter(s => s.primary);
	if (primaries.length !== 1) errors.push(`template "${template.id}": exactly one service must be primary (found ${primaries.length})`);

	// A `generate: jwt` secret is signed with another secret's value, so `signWith` must name an earlier-declared secret (it must exist when we mint it).
	const declaredSecrets = new Set<string>();
	for (const secret of template.secrets) {
		if (secret.generate === 'jwt' && !declaredSecrets.has(secret.signWith)) {
			errors.push(`secret "${secret.key}": signWith "${secret.signWith}" must reference an earlier secret`);
		}
		declaredSecrets.add(secret.key);
	}

	for (const service of template.services) {
		for (const value of configStrings(service.config)) {
			for (const ph of findPlaceholders(value)) {
				if (ph.ns === 'secrets' && !secretKeys.has(ph.key)) {
					errors.push(`service "${service.name}": unknown secret reference "${ph.key}"`);
				} else if (ph.ns === 'inputs' && !inputKeys.has(ph.key)) {
					errors.push(`service "${service.name}": unknown input reference "${ph.key}"`);
				} else if (ph.ns === 'services') {
					if (ph.sub !== 'host') errors.push(`service "${service.name}": only ".host" is supported on service references (got ".${ph.sub ?? ''}")`);
					else if (!serviceNames.has(ph.key)) errors.push(`service "${service.name}": unknown service reference "${ph.key}"`);
				} else if (!['secrets', 'inputs', 'services'].includes(ph.ns)) {
					errors.push(`service "${service.name}": unknown placeholder namespace "${ph.ns}"`);
				}
			}
		}
	}
	return errors;
}
