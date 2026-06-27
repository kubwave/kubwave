import { describe, expect, it } from 'bun:test';
import { runSteps } from '~/shared/worker-common/steps';

describe('runSteps', () => {
	it('runs every step in order', async () => {
		const order: string[] = [];
		await runSteps('test', [
			{
				name: 'a',
				run: async () => {
					order.push('a');
				}
			},
			{
				name: 'b',
				run: async () => {
					order.push('b');
				}
			}
		]);
		expect(order).toEqual(['a', 'b']);
	});

	it('a failing step does not stop later steps and does not reject', async () => {
		const order: string[] = [];
		await runSteps('test', [
			{
				name: 'boom',
				run: async () => {
					throw new Error('boom');
				}
			},
			{
				name: 'after',
				run: async () => {
					order.push('after');
				}
			}
		]);
		expect(order).toEqual(['after']);
	});
});
