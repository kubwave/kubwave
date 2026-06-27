import { internalServiceName } from '@kubwave/kube';
import type { ParsedComposeService } from './compose.types.js';

const SERVICE_REFERENCE_ENV_KEY_RE = /(^|_)(HOST|HOSTNAME|ADDR|ADDRESS|URL|URI|DSN|ENDPOINT|SERVER)$/i;

function canReferenceComposeService(key: string): boolean {
	return SERVICE_REFERENCE_ENV_KEY_RE.test(key);
}

function exactComposeServiceReference(value: string, names: Set<string>): string | null {
	const trimmed = value.trim();
	return names.has(trimmed) ? trimmed : null;
}

function collectExactEnvReferences(parsed: ParsedComposeService[]): Array<{ serviceName: string; envKey: string; targetName: string }> {
	const names = new Set(parsed.map(service => service.name));
	const references: Array<{ serviceName: string; envKey: string; targetName: string }> = [];

	for (const service of parsed) {
		for (const entry of service.config.env) {
			if (!canReferenceComposeService(entry.key)) continue;
			const targetName = exactComposeServiceReference(entry.value, names);
			if (targetName) references.push({ serviceName: service.name, envKey: entry.key, targetName });
		}
	}

	return references;
}

export function composeReferenceIssues(parsed: ParsedComposeService[]): string[] {
	const byName = new Map(parsed.map(service => [service.name, service]));
	const issues: string[] = [];

	for (const ref of collectExactEnvReferences(parsed)) {
		const target = byName.get(ref.targetName);
		if (target?.config.containerPort == null) {
			issues.push(
				`services.${ref.serviceName}.environment.${ref.envKey} references Compose service "${ref.targetName}", but that service does not expose a port. Add a ports/expose entry to "${ref.targetName}".`
			);
		}
	}

	return issues;
}

export function rewriteComposeServiceReferences(
	parsed: ParsedComposeService[],
	serviceIdsByName: ReadonlyMap<string, string>
): ParsedComposeService[] {
	const names = new Set(parsed.map(service => service.name));

	return parsed.map(service => ({
		...service,
		config: {
			...service.config,
			env: service.config.env.map(entry => {
				if (!canReferenceComposeService(entry.key)) return entry;
				const targetName = exactComposeServiceReference(entry.value, names);
				const targetId = targetName ? serviceIdsByName.get(targetName) : undefined;
				return targetId ? { ...entry, value: internalServiceName(targetId) } : entry;
			})
		}
	}));
}
