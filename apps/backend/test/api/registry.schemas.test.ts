import { describe, expect, test } from 'bun:test';
import { updateRegistrySettingsSchema } from '~/modules/platform/settings/registry/platform-registry-settings.dto';

describe('registry schemas', () => {
	test('accepts platform registry updates', () => {
		expect(updateRegistrySettingsSchema.parse({ mode: 'platform' })).toEqual({ mode: 'platform' });
	});

	test('accepts external registry updates with credentials', () => {
		expect(
			updateRegistrySettingsSchema.parse({
				mode: 'external',
				endpoint: 'registry.example.com/team',
				username: 'robot',
				password: 'token',
				insecure: true
			})
		).toEqual({
			mode: 'external',
			endpoint: 'registry.example.com/team',
			username: 'robot',
			password: 'token',
			insecure: true
		});
	});
});
