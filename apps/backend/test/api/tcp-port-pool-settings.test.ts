import { describe, expect, test } from 'bun:test';
import { tcpPortPoolSettingsSchema } from '~/modules/platform/settings/tcp-port-pool/platform-tcp-port-pool-settings.dto';
import { tcpPortPoolConflicts } from '~/modules/platform/settings/tcp-port-pool/tcp-port-pool.rules';

describe('TCP port pool settings', () => {
	test('accepts the supported port and size boundaries', () => {
		expect(tcpPortPoolSettingsSchema.safeParse({ enabled: true, start: 1024, size: 1 }).success).toBe(true);
		expect(tcpPortPoolSettingsSchema.safeParse({ enabled: true, start: 65436, size: 100 }).success).toBe(true);
	});

	test('rejects invalid ports, sizes, and ranges that exceed the TCP port limit', () => {
		expect(tcpPortPoolSettingsSchema.safeParse({ enabled: true, start: 1023, size: 1 }).success).toBe(false);
		expect(tcpPortPoolSettingsSchema.safeParse({ enabled: true, start: 30100, size: 101 }).success).toBe(false);
		expect(tcpPortPoolSettingsSchema.safeParse({ enabled: true, start: 65535, size: 2 }).success).toBe(false);
	});

	test('reports public ports that would be removed from the pool', () => {
		expect(tcpPortPoolConflicts({ enabled: true, start: 30100, size: 2 }, [30100, 30101, 30102])).toEqual([30102]);
	});

	test('requires every existing exposure to be removed before disabling', () => {
		expect(tcpPortPoolConflicts({ enabled: false, start: 30100, size: 20 }, [30100, 30103])).toEqual([30100, 30103]);
	});
});
