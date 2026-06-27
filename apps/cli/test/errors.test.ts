import { describe, expect, test } from 'bun:test';
import { CliError, FatalCliError, HelmCommandError, UserCancelledError, printAndExit as printAndExitImported } from '../src/lib/errors.js';

describe('CLI errors', () => {
	test('constructs typed CLI errors with exit codes and causes', () => {
		const cause = new Error('cause');
		expect(new CliError('plain').exitCode).toBe(1);
		expect(new UserCancelledError().exitCode).toBe(0);
		expect(new FatalCliError('fatal', { cause }).cause).toBe(cause);

		const helm = new HelmCommandError(['upgrade', 'kubwave'], { exitCode: 2, stdout: 'out', stderr: 'err' });
		expect(helm.message).toContain('helm upgrade kubwave');
		expect(helm.message).toContain('err');
		expect(helm.exitCode).toBe(2);
		expect(helm.stdout).toBe('out');
	});

	test('exits cleanly for user cancellations', () => {
		const harness = createPrintHarness();

		expect(() => harness.printAndExit(new UserCancelledError('stop'))).toThrow(ExitSignal);
		expect(caughtExitCode(() => harness.printAndExit(new UserCancelledError('stop')))).toBe(0);
		expect(harness.cancellations).toEqual(['stop', 'stop']);
	});

	test('prints HTTP status, formatted body, and stack when present', () => {
		const harness = createPrintHarness();
		const err = Object.assign(new Error('bad request\nsecond line'), {
			code: 422,
			body: '{"kind":"Status","message":"invalid"}'
		});

		expect(caughtExitCode(() => harness.printAndExit(err))).toBe(1);
		expect(harness.flatErrors()).toContain('Error: HTTP 422 — bad request');
		expect(harness.flatErrors()).toContain('Body:');
		expect(harness.flatErrors()).toContain('"message": "invalid"');
	});

	test('prints CLI errors with their configured exit code', () => {
		const harness = createPrintHarness();

		expect(caughtExitCode(() => harness.printAndExit(new CliError('bad flag', { exitCode: 3 })))).toBe(3);
		expect(harness.flatErrors()).toContain('Error: bad flag');
	});

	test('prints ordinary errors and non-error values', () => {
		const harness = createPrintHarness();

		expect(caughtExitCode(() => harness.printAndExit(new Error('boom')))).toBe(1);
		expect(harness.flatErrors()).toContain('Error: boom');

		harness.clearErrors();
		expect(caughtExitCode(() => harness.printAndExit('plain failure'))).toBe(1);
		expect(harness.flatErrors()).toContain('plain failure');
	});
});

function caughtExitCode(fn: () => never): number | undefined {
	try {
		fn();
	} catch (err) {
		if (err instanceof ExitSignal) return err.code;
		throw err;
	}
}

class ExitSignal extends Error {
	code?: number;

	constructor(code?: number) {
		super(`exit ${code}`);
		this.code = code;
	}
}

function createPrintHarness() {
	let errors: unknown[][] = [];
	const cancellations: string[] = [];

	return {
		cancellations,
		clearErrors() {
			errors = [];
		},
		flatErrors() {
			return errors.map(args => args.join(' ')).join('\n');
		},
		printAndExit(err: unknown): never {
			return printAndExitImported(err, {
				cancel: message => {
					cancellations.push(message);
				},
				error: (...args: unknown[]) => {
					errors.push(args);
				},
				exit: (code?: number) => {
					throw new ExitSignal(code);
				}
			});
		}
	};
}
