import { describe, expect, mock, test } from 'bun:test';
import { detectFleetProviders, parseCfkeProviderLabel, parseProviderId } from '../src/lib/cloud-provider.js';

describe('cloud provider detection', () => {
	test('parseProviderId extracts aws', () => {
		expect(parseProviderId('aws:///us-east-1/i-12345')).toBe('aws');
	});

	test('parseProviderId extracts gcp from gce prefix', () => {
		expect(parseProviderId('gce://project/zone/nodename')).toBe('gcp');
	});

	test('parseProviderId extracts hetzner from hcloud prefix', () => {
		expect(parseProviderId('hcloud://12345')).toBe('hetzner');
	});

	test('parseProviderId is case-insensitive', () => {
		expect(parseProviderId('AWS:///region/instance')).toBe('aws');
	});

	test('parseProviderId returns null for empty input', () => {
		expect(parseProviderId('')).toBeNull();
		expect(parseProviderId(null!)).toBeNull();
		expect(parseProviderId(undefined)).toBeNull();
	});

	test('parseProviderId returns null for unknown prefix', () => {
		expect(parseProviderId('azure:///sub/resource')).toBeNull();
	});

	test('parseCfkeProviderLabel extracts from known labels', () => {
		expect(parseCfkeProviderLabel('aws')).toBe('aws');
		expect(parseCfkeProviderLabel('gcp')).toBe('gcp');
		expect(parseCfkeProviderLabel('google')).toBe('gcp');
		expect(parseCfkeProviderLabel('hetzner')).toBe('hetzner');
		expect(parseCfkeProviderLabel('hcloud')).toBe('hetzner');
	});

	test('parseCfkeProviderLabel is case-insensitive', () => {
		expect(parseCfkeProviderLabel('AWS')).toBe('aws');
	});

	test('parseCfkeProviderLabel returns null for empty or unknown', () => {
		expect(parseCfkeProviderLabel('')).toBeNull();
		expect(parseCfkeProviderLabel(null!)).toBeNull();
		expect(parseCfkeProviderLabel(undefined)).toBeNull();
		expect(parseCfkeProviderLabel('unknown')).toBeNull();
	});

	test('detectFleetProviders counts providers from nodes', async () => {
		const kc = {
			makeApiClient: () => ({
				listNode: mock().mockResolvedValue({
					items: [
						{ spec: { providerID: 'aws:///us-east-1/i-1' }, metadata: { labels: {} } },
						{ spec: { providerID: 'aws:///us-east-1/i-2' }, metadata: { labels: {} } },
						{ spec: { providerID: 'gce:///project/zone/n' }, metadata: { labels: {} } },
						{
							spec: { providerID: '' },
							metadata: { labels: { 'cfke.io/provider': 'hetzner' } }
						}
					]
				})
			})
		} as never;

		const counts = await detectFleetProviders(kc);
		expect(counts.get('aws')).toBe(2);
		expect(counts.get('gcp')).toBe(1);
		expect(counts.get('hetzner')).toBe(1);
	});

	test('detectFleetProviders prefers providerID over label', async () => {
		const kc = {
			makeApiClient: () => ({
				listNode: mock().mockResolvedValue({
					items: [
						{
							spec: { providerID: 'aws:///us-east-1/i-1' },
							metadata: { labels: { 'cfke.io/provider': 'hcloud' } }
						}
					]
				})
			})
		} as never;

		const counts = await detectFleetProviders(kc);
		expect(counts.get('aws')).toBe(1);
		expect(counts.get('hetzner')).toBeUndefined();
	});

	test('detectFleetProviders returns empty map for no matching nodes', async () => {
		const kc = {
			makeApiClient: () => ({
				listNode: mock().mockResolvedValue({ items: [] })
			})
		} as never;

		const counts = await detectFleetProviders(kc);
		expect(counts.size).toBe(0);
	});
});
