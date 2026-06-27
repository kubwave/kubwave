import { describe, expect, test } from 'bun:test';
import {
	buildRegistryCredentialHash,
	buildRegistryEndpointHost,
	buildRegistryNetworkPolicyEgressPorts,
	normalizeBuildRegistrySettings,
	parseBuildRegistryEndpoint
} from '../src/platform/registry';

describe('registry config helpers', () => {
	test('normalizes an external endpoint and extracts host/port', () => {
		expect(parseBuildRegistryEndpoint(' registry.example.com:5000/team/ ')).toEqual({
			endpoint: 'registry.example.com:5000/team',
			host: 'registry.example.com:5000',
			port: 5000
		});
		expect(buildRegistryEndpointHost('registry.example.com/team')).toBe('registry.example.com');
		expect(buildRegistryNetworkPolicyEgressPorts('registry.example.com:5000/team')).toEqual([80, 443, 5000]);
	});

	test('rejects URL schemes and malformed ports', () => {
		expect(() => parseBuildRegistryEndpoint('https://registry.example.com/team')).toThrow('must not include a URL scheme');
		expect(() => parseBuildRegistryEndpoint('registry.example.com:nope/team')).toThrow('port must be numeric');
	});

	test('normalizes stored settings defensively', () => {
		expect(normalizeBuildRegistrySettings(null)).toEqual({ mode: 'unconfigured' });
		expect(normalizeBuildRegistrySettings({ mode: 'platform' })).toEqual({ mode: 'platform' });
		expect(normalizeBuildRegistrySettings({ mode: 'external', endpoint: 'reg.example.com/team', username: 'robot', insecure: true })).toEqual({
			mode: 'external',
			endpoint: 'reg.example.com/team',
			username: 'robot',
			insecure: true
		});
	});

	test('hashes external registry credentials into a stable drift marker', () => {
		const settings = {
			mode: 'external',
			endpoint: 'reg.example.com/team',
			username: 'robot',
			insecure: false,
			passwordCiphertext: 'v1:encrypted'
		} as const;

		expect(buildRegistryCredentialHash(settings)).toBe(buildRegistryCredentialHash({ ...settings }));
		expect(buildRegistryCredentialHash(settings)).not.toBe(buildRegistryCredentialHash({ ...settings, passwordCiphertext: 'v1:rotated' }));
		expect(buildRegistryCredentialHash(settings)).not.toBe(buildRegistryCredentialHash({ ...settings, username: 'other' }));
	});
});
