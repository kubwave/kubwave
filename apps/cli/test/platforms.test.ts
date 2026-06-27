import { describe, expect, mock, test } from 'bun:test';

const cancelled = Symbol('cancelled');
let selectValue: string | symbol = 'cloudfleet-hetzner';

mock.module('@clack/prompts', () => ({
	isCancel: (value: unknown) => value === cancelled,
	select: mock(async () => {
		return typeof selectValue === 'symbol' ? cancelled : selectValue;
	})
}));

const { getPlatformDescriptor, selectPlatform, PLATFORMS } = await import('../src/lib/platforms.js');

describe('getPlatformDescriptor', () => {
	test('returns descriptor for known platform ID', () => {
		const desc = getPlatformDescriptor('cloudfleet-hetzner');
		expect(desc.id).toBe('cloudfleet-hetzner');
		expect(desc.label).toBe('Cloudfleet (Hetzner)');
	});

	test('throws with available platforms for unknown ID', () => {
		expect(() => getPlatformDescriptor('unknown')).toThrow('Unknown platform "unknown". Available: cloudfleet-hetzner');
	});
});

describe('selectPlatform', () => {
	test('uses explicit platform flag without prompting', async () => {
		const platform = await selectPlatform({ platform: 'cloudfleet-hetzner', hetznerLbLocation: 'fsn1' });
		expect(platform.id).toBe('cloudfleet-hetzner');
		expect(platform.label).toBe('Cloudfleet (Hetzner)');
	});

	test('prompts interactively when no platform flag', async () => {
		selectValue = 'cloudfleet-hetzner';
		const platform = await selectPlatform({});
		expect(platform.id).toBe('cloudfleet-hetzner');
	});

	test('throws UserCancelledError when selection is cancelled', async () => {
		selectValue = cancelled;
		await expect(selectPlatform({})).rejects.toThrow('Platform selection aborted.');
	});
});

describe('PLATFORMS registry', () => {
	test('contains cloudfleet-hetzner', () => {
		const ids = PLATFORMS.map(d => d.id);
		expect(ids).toContain('cloudfleet-hetzner');
	});
});
