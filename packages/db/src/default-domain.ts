// Auto-generated domain for tenant services (`<service>-<shortId>.<base>`); pure so API and worker derive the same host from identical inputs.

export const DEFAULT_DOMAIN_SETTINGS_KEY = 'default-domain';
export const DEFAULT_DOMAIN_RUNTIME_KEY = 'default-domain-runtime';

export type DefaultDomainMode = 'off' | 'wildcard' | 'sslip';

export interface DefaultDomainSettings {
	mode: DefaultDomainMode;
	base: string | null;
	subdomainTemplate: string | null;
}

export const DEFAULT_DOMAIN_DEFAULTS: DefaultDomainSettings = {
	mode: 'sslip',
	base: null,
	subdomainTemplate: null
};

export interface DefaultDomainRuntime {
	ingressIp: string | null;
	tls: boolean;
}

export const DEFAULT_DOMAIN_RUNTIME_DEFAULTS: DefaultDomainRuntime = {
	ingressIp: null,
	tls: false
};

const DEFAULT_TEMPLATE = '{name}-{shortId}';
const MAX_LABEL = 63; // RFC1123 single-label limit
const MAX_FQDN = 253;

export function sanitizeDnsLabel(name: string): string {
	const s = name
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	return s || 'app';
}

export function shortIdFromServiceId(serviceId: string): string {
	return serviceId.replace(/-/g, '').slice(0, 8);
}

export function sslipBaseFromIp(ip: string): string {
	return `${ip.trim().replace(/\./g, '-')}.sslip.io`;
}

export function isIpv4(value: string): boolean {
	const parts = value.trim().split('.');
	if (parts.length !== 4) return false;
	return parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function effectiveBase(settings: DefaultDomainSettings, runtime: DefaultDomainRuntime): string | null {
	if (settings.mode === 'wildcard') return settings.base?.trim() || null;
	if (settings.mode === 'sslip') return runtime.ingressIp && isIpv4(runtime.ingressIp) ? sslipBaseFromIp(runtime.ingressIp) : null;
	return null;
}

function clampLabel(label: string): string {
	if (label.length <= MAX_LABEL) return label;
	const m = label.match(/-([0-9a-f]{8})$/);
	if (m) {
		const suffix = `-${m[1]}`;
		const head = label.slice(0, MAX_LABEL - suffix.length).replace(/-+$/, '');
		return `${head}${suffix}`;
	}
	return label.slice(0, MAX_LABEL).replace(/-+$/, '');
}

export function buildDefaultDomainHost(
	base: string | null,
	subdomainTemplate: string | null,
	service: { serviceId: string; serviceName: string }
): string | null {
	const cleanBase = base?.trim();
	if (!cleanBase) return null;

	const template = subdomainTemplate?.trim() || DEFAULT_TEMPLATE;
	const rendered = template.replace('{name}', sanitizeDnsLabel(service.serviceName)).replace('{shortId}', shortIdFromServiceId(service.serviceId));
	// Re-sanitize after substitution: unknown tokens keep their literal braces, which sanitizeDnsLabel strips so the host stays RFC1123-valid.
	const label = clampLabel(sanitizeDnsLabel(rendered));
	if (!label) return null;

	const host = `${label}.${cleanBase}`;
	if (host.length > MAX_FQDN) return null;
	return host;
}

export function resolveDefaultDomainSettings(stored: Partial<DefaultDomainSettings> | null | undefined): DefaultDomainSettings {
	return {
		mode: stored?.mode ?? DEFAULT_DOMAIN_DEFAULTS.mode,
		base: stored?.base ?? DEFAULT_DOMAIN_DEFAULTS.base,
		subdomainTemplate: stored?.subdomainTemplate ?? DEFAULT_DOMAIN_DEFAULTS.subdomainTemplate
	};
}

export function resolveDefaultDomainRuntime(stored: Partial<DefaultDomainRuntime> | null | undefined): DefaultDomainRuntime {
	return {
		ingressIp: stored?.ingressIp ?? DEFAULT_DOMAIN_RUNTIME_DEFAULTS.ingressIp,
		tls: stored?.tls ?? DEFAULT_DOMAIN_RUNTIME_DEFAULTS.tls
	};
}

export function buildDefaultDomainForService(
	settings: DefaultDomainSettings,
	runtime: DefaultDomainRuntime,
	service: { serviceId: string; serviceName: string }
): string | null {
	return buildDefaultDomainHost(effectiveBase(settings, runtime), settings.subdomainTemplate, service);
}
