import { describe, expect, mock, test } from 'bun:test';
import { clackStub } from './support/clack-stub.js';

const cancelled = Symbol('cancelled');
let selectValue: string | symbol = 'fsn1';

mock.module('@clack/prompts', () => ({
	...clackStub(),
	isCancel: (value: unknown) => value === cancelled,
	select: mock(async () => {
		return typeof selectValue === 'symbol' ? cancelled : selectValue;
	})
}));

const { promptHetznerOptions, HETZNER_LB_LOCATIONS } = await import('../src/platforms/cloudfleet/options.js');

describe('promptHetznerOptions', () => {
	test('returns explicit lbLocation when valid', async () => {
		const result = await promptHetznerOptions({ lbLocation: 'nbg1' });
		expect(result).toEqual({ lbLocation: 'nbg1' });
	});

	test('throws FatalCliError for unknown lbLocation', async () => {
		await expect(promptHetznerOptions({ lbLocation: 'unknown' })).rejects.toThrow('Unknown Hetzner LB location "unknown"');
		await expect(promptHetznerOptions({ lbLocation: 'unknown' })).rejects.toThrow('Allowed: fsn1, nbg1, hel1, ash, hil');
	});

	test('prompts interactively when no lbLocation flag', async () => {
		selectValue = 'hel1';
		const result = await promptHetznerOptions({});
		expect(result).toEqual({ lbLocation: 'hel1' });
	});

	test('throws UserCancelledError when selection is cancelled', async () => {
		selectValue = cancelled;
		await expect(promptHetznerOptions({})).rejects.toThrow('Hetzner LB location selection aborted.');
	});
});

describe('HETZNER_LB_LOCATIONS', () => {
	test('contains expected locations', () => {
		expect(HETZNER_LB_LOCATIONS).toContain('fsn1');
		expect(HETZNER_LB_LOCATIONS).toContain('nbg1');
		expect(HETZNER_LB_LOCATIONS).toContain('hel1');
		expect(HETZNER_LB_LOCATIONS).toContain('ash');
		expect(HETZNER_LB_LOCATIONS).toContain('hil');
	});
});
