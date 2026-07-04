import { describe, expect, test } from 'bun:test';
import { planWarmup } from '../src/lib/node-warmup.js';

describe('planWarmup', () => {
	test('returns null when capacity covers the requirement', () => {
		const required = { cpuMillis: 1000, memBytes: 2 * 2 ** 30 };
		const available = { cpuMillis: 2000, memBytes: 4 * 2 ** 30 };
		expect(planWarmup(required, available, false)).toBeNull();
	});

	test('sizes a single primer node for a small deficit (non-HA)', () => {
		const required = { cpuMillis: 900, memBytes: 2 * 2 ** 30 };
		const available = { cpuMillis: 0, memBytes: 0 };
		const plan = planWarmup(required, available, false);
		expect(plan).not.toBeNull();
		expect(plan!.replicas).toBe(1); // ceil(900/1000)=1, ceil(2Gi/2Gi)=1
		expect(plan!.deficit).toEqual({ cpuMillis: 900, memBytes: 2 * 2 ** 30 });
	});

	test('scales replicas up for a large deficit', () => {
		const required = { cpuMillis: 5000, memBytes: 10 * 2 ** 30 };
		const available = { cpuMillis: 0, memBytes: 0 };
		const plan = planWarmup(required, available, false);
		// ceil(5000/1000)=5 by cpu; ceil(10Gi/2Gi)=5 by mem
		expect(plan!.replicas).toBe(5);
		expect(plan!.perPod).toEqual({ cpuMillis: 1000, memBytes: 2 * 2 ** 30 });
	});

	test('HA enforces a minimum of 3 primer nodes even for a tiny deficit', () => {
		const required = { cpuMillis: 500, memBytes: 512 * 2 ** 20 };
		const available = { cpuMillis: 100, memBytes: 0 };
		const plan = planWarmup(required, available, true);
		expect(plan!.replicas).toBe(3);
	});

	test('deficit only in one dimension still triggers a plan', () => {
		const required = { cpuMillis: 100, memBytes: 8 * 2 ** 30 };
		const available = { cpuMillis: 4000, memBytes: 2 * 2 ** 30 };
		const plan = planWarmup(required, available, false);
		expect(plan).not.toBeNull();
		expect(plan!.deficit.cpuMillis).toBe(0);
		expect(plan!.deficit.memBytes).toBe(6 * 2 ** 30);
	});
});
