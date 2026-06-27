import type { CatalogTemplate } from '@kubwave/templates';

export interface ResolveContext {
	secrets: Record<string, string>;
	inputs: Record<string, string>;
	services: Record<string, { host: string }>;
}

type TemplateServiceConfig = CatalogTemplate['services'][number]['config'];

export interface ResolvedServiceConfig {
	image: string;
	tag: string;
	containerPort: number | null;
	defaultDomainEnabled?: boolean;
	env: Array<{ key: string; value: string }>;
	secrets: Array<{ key: string; value: string }>;
	domains: Array<{ host: string; port: number }>;
	volumes: Array<{ name: string; mountPath: string; size: string; subPath?: string }>;
	configFiles: Array<{ path: string; content: string }>;
	command?: string[];
	args?: string[];
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z]+)\.([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\s*\}\}/g;

export function resolveTemplateString(value: string, ctx: ResolveContext): string {
	return value.replace(PLACEHOLDER_RE, (_full, ns: string, key: string, sub: string | undefined) => {
		if (ns === 'secrets') {
			const v = ctx.secrets[key];
			if (v === undefined) throw new Error(`unresolved secret reference: ${key}`);
			return v;
		}
		if (ns === 'inputs') {
			const v = ctx.inputs[key];
			if (v === undefined) throw new Error(`unresolved input reference: ${key}`);
			return v;
		}
		if (ns === 'services' && sub === 'host') {
			const svc = ctx.services[key];
			if (!svc) throw new Error(`unresolved service reference: ${key}`);
			return svc.host;
		}
		throw new Error(`unsupported placeholder: ${ns}.${key}${sub ? '.' + sub : ''}`);
	});
}

export function resolveTemplateServiceConfig(config: TemplateServiceConfig, ctx: ResolveContext): ResolvedServiceConfig {
	return {
		image: config.image,
		tag: config.tag,
		containerPort: config.containerPort,
		...(config.defaultDomainEnabled === true ? { defaultDomainEnabled: true } : {}),
		env: config.env.map(e => ({ key: e.key, value: resolveTemplateString(e.value, ctx) })),
		secrets: config.secrets.map(s => ({ key: s.key, value: resolveTemplateString(s.value, ctx) })),
		domains: config.domains.map(d => ({ host: resolveTemplateString(d.host, ctx), port: d.port })),
		volumes: config.volumes.map(v => ({ name: v.name, mountPath: v.mountPath, size: v.size, ...(v.subPath ? { subPath: v.subPath } : {}) })),
		configFiles: config.configFiles.map(f => ({ path: f.path, content: resolveTemplateString(f.content, ctx) })),
		...(config.command ? { command: config.command.map(c => resolveTemplateString(c, ctx)) } : {}),
		...(config.args ? { args: config.args.map(a => resolveTemplateString(a, ctx)) } : {})
	};
}
