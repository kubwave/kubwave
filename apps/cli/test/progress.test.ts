import { afterEach, describe, expect, test } from 'bun:test';
import { DbReporter, StdoutReporter } from '../src/lib/progress.js';

const realLog = console.log;
const realError = console.error;
let output: string[] = [];

afterEach(() => {
	console.log = realLog;
	console.error = realError;
	output = [];
});

describe('progress reporters', () => {
	test('writes DB-backed update status transitions', async () => {
		const updates: Array<[string, string, string | undefined]> = [];
		console.log = (msg: string) => output.push(msg);
		console.error = (msg: string) => output.push(msg);
		const reporter = new DbReporter(async (status, phase, error) => {
			updates.push([status, phase, error]);
		});

		reporter.start('prepare');
		reporter.succeed('dependencies');
		reporter.fail('helm', 'bad values');
		reporter.log('message');
		reporter.finish('rolled_back', 'restored');

		await Bun.sleep(0);

		expect(updates).toEqual([
			['running', 'prepare', undefined],
			['running', 'dependencies', undefined],
			['failed', 'helm', 'bad values'],
			['rolled_back', 'done', 'restored']
		]);
		expect(output).toContain('[update] prepare');
		expect(output).toContain('[update] ✗ helm: bad values');
		expect(output).toContain('[update] rolled_back: restored');
	});

	test('finish resolves only after the terminal status write completes', async () => {
		console.log = (msg: string) => output.push(msg);
		const order: string[] = [];
		let resolveWrite!: () => void;
		const reporter = new DbReporter(
			() =>
				new Promise<void>(resolve => {
					resolveWrite = () => {
						order.push('status-write');
						resolve();
					};
				})
		);

		const finished = Promise.resolve(reporter.finish('succeeded', 'done')).then(() => order.push('finish-returned'));

		await Bun.sleep(0);
		expect(order).toEqual([]); // still pending: the DB write has not resolved yet

		resolveWrite();
		await finished;
		expect(order).toEqual(['status-write', 'finish-returned']);
	});

	test('drives the stdout reporter methods without leaking active state', () => {
		const reporter = new StdoutReporter();

		expect(() => {
			reporter.start('one');
			reporter.start('two');
			reporter.succeed('done');
			reporter.start('three');
			reporter.fail('failed', 'reason');
			reporter.log('message');
			reporter.finish('succeeded', 'ok');
			reporter.finish('failed', 'bad');
		}).not.toThrow();
	});
});
