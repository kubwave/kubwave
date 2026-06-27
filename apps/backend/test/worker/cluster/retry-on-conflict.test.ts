import { describe, expect, test } from 'bun:test';
import { retryOnConflict } from '~/shared/cluster/ops';

const conflict = { code: 409 };

describe('retryOnConflict', () => {
	test('runs the attempt once on success', async () => {
		let calls = 0;
		await retryOnConflict('test', 3, async () => {
			calls++;
		});
		expect(calls).toBe(1);
	});

	test('re-runs the attempt after a 409 conflict, then succeeds', async () => {
		let calls = 0;
		await retryOnConflict('test', 3, async () => {
			calls++;
			if (calls === 1) throw conflict;
		});
		expect(calls).toBe(2);
	});

	test('gives up after exhausting attempts on persistent conflict (no throw)', async () => {
		let calls = 0;
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (msg?: unknown) => void warnings.push(String(msg));
		try {
			await retryOnConflict('widget', 3, async () => {
				calls++;
				throw conflict;
			});
		} finally {
			console.warn = originalWarn;
		}
		expect(calls).toBe(3);
		expect(warnings.some(w => w.includes('widget') && w.includes('3'))).toBe(true);
	});

	test('propagates a non-conflict error without retrying', async () => {
		let calls = 0;
		const boom = { code: 500 };
		await expect(
			retryOnConflict('test', 3, async () => {
				calls++;
				throw boom;
			})
		).rejects.toBe(boom);
		expect(calls).toBe(1);
	});
});
