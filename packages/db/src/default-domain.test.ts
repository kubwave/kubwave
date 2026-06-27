import { describe, expect, test } from 'bun:test';
import {
	buildDefaultDomainForService,
	buildDefaultDomainHost,
	effectiveBase,
	sanitizeDnsLabel,
	shortIdFromServiceId,
	sslipBaseFromIp,
	type DefaultDomainRuntime,
	type DefaultDomainSettings
} from './default-domain';

const ID = '1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809';
const svc = { serviceId: ID, serviceName: 'web' };

describe('sanitizeDnsLabel', () => {
	test('lowercases, replaces invalid chars, collapses and trims dashes', () => {
		expect(sanitizeDnsLabel('My App!')).toBe('my-app');
		expect(sanitizeDnsLabel('  weird__name..v2  ')).toBe('weird-name-v2');
		expect(sanitizeDnsLabel('--lead-trail--')).toBe('lead-trail');
	});
	test('falls back to "app" for an empty result', () => {
		expect(sanitizeDnsLabel('!!!')).toBe('app');
		expect(sanitizeDnsLabel('')).toBe('app');
	});
});

describe('shortIdFromServiceId', () => {
	test('strips dashes and takes the first 8 hex chars', () => {
		expect(shortIdFromServiceId(ID)).toBe('1a2b3c4d');
	});
});

describe('sslipBaseFromIp', () => {
	test('dots become dashes under sslip.io', () => {
		expect(sslipBaseFromIp('1.2.3.4')).toBe('1-2-3-4.sslip.io');
		expect(sslipBaseFromIp('127.0.0.1')).toBe('127-0-0-1.sslip.io');
	});
});

describe('effectiveBase', () => {
	const runtime: DefaultDomainRuntime = { ingressIp: '5.6.7.8', tls: true };
	test('wildcard → operator base', () => {
		expect(effectiveBase({ mode: 'wildcard', base: 'apps.mycloud.com', subdomainTemplate: null }, runtime)).toBe('apps.mycloud.com');
	});
	test('sslip → derived from ingress IP', () => {
		expect(effectiveBase({ mode: 'sslip', base: null, subdomainTemplate: null }, runtime)).toBe('5-6-7-8.sslip.io');
	});
	test('sslip with no resolved IP → null', () => {
		expect(effectiveBase({ mode: 'sslip', base: null, subdomainTemplate: null }, { ingressIp: null, tls: false })).toBeNull();
	});
	test('sslip with a hostname LoadBalancer (not an IPv4) → null, not a mangled host', () => {
		const settings: DefaultDomainSettings = { mode: 'sslip', base: null, subdomainTemplate: null };
		expect(effectiveBase(settings, { ingressIp: 'a1b2.elb.amazonaws.com', tls: true })).toBeNull();
		expect(effectiveBase(settings, { ingressIp: '2001:db8::1', tls: true })).toBeNull();
	});
	test('off → null', () => {
		expect(effectiveBase({ mode: 'off', base: 'apps.mycloud.com', subdomainTemplate: null }, runtime)).toBeNull();
	});
});

describe('buildDefaultDomainHost', () => {
	test('returns null when base is unset/blank', () => {
		expect(buildDefaultDomainHost(null, null, svc)).toBeNull();
		expect(buildDefaultDomainHost('   ', null, svc)).toBeNull();
	});
	test('builds <name>-<shortId>.<base> by default', () => {
		expect(buildDefaultDomainHost('apps.mycloud.com', null, svc)).toBe('web-1a2b3c4d.apps.mycloud.com');
	});
	test('works against an sslip base', () => {
		expect(buildDefaultDomainHost('127-0-0-1.sslip.io', null, svc)).toBe('web-1a2b3c4d.127-0-0-1.sslip.io');
	});
	test('sanitizes the service name', () => {
		expect(buildDefaultDomainHost('apps.mycloud.com', null, { serviceId: ID, serviceName: 'My API!' })).toBe('my-api-1a2b3c4d.apps.mycloud.com');
	});
	test('honors a custom template', () => {
		expect(buildDefaultDomainHost('apps.mycloud.com', 'svc-{shortId}', svc)).toBe('svc-1a2b3c4d.apps.mycloud.com');
	});
	test('an unknown/typo token does not leak literal braces into the host', () => {
		const host = buildDefaultDomainHost('apps.mycloud.com', 'svc-{nme}', svc);
		expect(host).not.toBeNull();
		expect(host).not.toContain('{');
		expect(host).not.toContain('}');
		// label stays a valid RFC1123 single label
		expect(host!.split('.')[0]).toMatch(/^[a-z0-9-]+$/);
	});
	test('clamps a long label to 63 chars, preserving the -<shortId> suffix', () => {
		const host = buildDefaultDomainHost('apps.mycloud.com', null, { serviceId: ID, serviceName: 'a'.repeat(120) });
		expect(host).not.toBeNull();
		const label = host!.split('.')[0]!;
		expect(label.length).toBeLessThanOrEqual(63);
		expect(label.endsWith('-1a2b3c4d')).toBe(true);
	});
	test('returns null when the full FQDN would exceed 253 chars', () => {
		const longBase = `${'sub.'.repeat(70)}example.com`;
		expect(buildDefaultDomainHost(longBase, null, svc)).toBeNull();
	});
});

describe('buildDefaultDomainForService', () => {
	test('sslip default mode resolves through the runtime IP', () => {
		const settings: DefaultDomainSettings = { mode: 'sslip', base: null, subdomainTemplate: null };
		const runtime: DefaultDomainRuntime = { ingressIp: '127.0.0.1', tls: false };
		expect(buildDefaultDomainForService(settings, runtime, svc)).toBe('web-1a2b3c4d.127-0-0-1.sslip.io');
	});
	test('off mode → null regardless of runtime', () => {
		const settings: DefaultDomainSettings = { mode: 'off', base: null, subdomainTemplate: null };
		expect(buildDefaultDomainForService(settings, { ingressIp: '1.2.3.4', tls: true }, svc)).toBeNull();
	});
});
