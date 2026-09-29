import { describe, expect, test } from 'bun:test';
import type { RegistrySettingsDto } from '@kubwave/api-client';
import { registryDraftFrom, registryErrors, registryPayload, registryPollInterval, type RegistryDraft } from '../features/platform/registry-model';

const settings = (overrides: Partial<RegistrySettingsDto>): RegistrySettingsDto => ({
	mode: 'unconfigured',
	endpoint: null,
	insecure: false,
	username: null,
	hasPassword: false,
	applyStatus: 'not_configured',
	activeRunId: null,
	lastError: null,
	...overrides
});

const external: RegistryDraft = { mode: 'external', endpoint: ' ghcr.io/acme ', insecure: true, username: ' bot ', password: '' };

describe('registryDraftFrom', () => {
	test('starts an unconfigured platform on the managed registry', () => {
		expect(registryDraftFrom(settings({}))).toEqual({ mode: 'platform', endpoint: '', insecure: false, username: '', password: '' });
	});

	test('prefills an external registry but never the stored password', () => {
		expect(registryDraftFrom(settings({ mode: 'external', endpoint: 'ghcr.io/acme', username: 'bot', insecure: true, hasPassword: true }))).toEqual({
			mode: 'external',
			endpoint: 'ghcr.io/acme',
			insecure: true,
			username: 'bot',
			password: ''
		});
	});
});

describe('registryErrors', () => {
	test('the managed registry needs nothing', () => {
		expect(registryErrors({ ...external, mode: 'platform', endpoint: '', username: '' }, false)).toEqual({});
	});

	test('an external registry needs endpoint, username and a password unless one is stored', () => {
		expect(registryErrors({ ...external, endpoint: ' ', username: '' }, false)).toEqual({
			endpoint: 'Enter the registry endpoint.',
			username: 'Enter a username.',
			password: 'Enter a password or token.'
		});
		expect(registryErrors(external, true)).toEqual({});
	});
});

describe('registryPayload', () => {
	test('sends only the mode for the managed registry', () => {
		expect(registryPayload({ ...external, mode: 'platform' })).toEqual({ mode: 'platform' });
	});

	test('trims an external registry and keeps the stored password when none was typed', () => {
		expect(registryPayload(external)).toEqual({ mode: 'external', endpoint: 'ghcr.io/acme', insecure: true, username: 'bot' });
		expect(registryPayload({ ...external, password: 's3cret' })).toMatchObject({ password: 's3cret' });
	});
});

describe('registryPollInterval', () => {
	test('polls every 3s while the platform applies the registry, then stops', () => {
		expect(registryPollInterval(settings({ applyStatus: 'pending' }))).toBe(3000);
		expect(registryPollInterval(settings({ applyStatus: 'applying' }))).toBe(3000);
		expect(registryPollInterval(settings({ applyStatus: 'applied' }))).toBe(false);
		expect(registryPollInterval(undefined)).toBe(false);
	});
});
