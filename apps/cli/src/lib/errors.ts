import * as p from '@clack/prompts';
import { getStatusCode, getStatusBody } from '~/lib/k8s-errors.js';

export class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, opts: { exitCode?: number; cause?: unknown } = {}) {
		super(message);
		this.name = 'CliError';
		this.exitCode = opts.exitCode ?? 1;
		this.cause = opts.cause;
	}
}

export class UserCancelledError extends CliError {
	constructor(message: string = 'Command cancelled.') {
		super(message, { exitCode: 0 });
		this.name = 'UserCancelledError';
	}
}

export class FatalCliError extends CliError {
	constructor(message: string, opts: { cause?: unknown } = {}) {
		super(message, { exitCode: 1, cause: opts.cause });
		this.name = 'FatalCliError';
	}
}

export class HelmCommandError extends CliError {
	readonly command: string[];
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;

	constructor(command: string[], result: { exitCode: number; stdout: string; stderr: string }) {
		const output = result.stderr || result.stdout;
		super(`Helm command failed (exit ${result.exitCode}): helm ${command.join(' ')}${output ? `\n${output}` : ''}`, { exitCode: result.exitCode });
		this.name = 'HelmCommandError';
		this.command = command;
		this.exitCode = result.exitCode;
		this.stdout = result.stdout;
		this.stderr = result.stderr;
	}
}

type PrintAndExitOptions = {
	cancel?: (message: string) => unknown;
	error?: (...args: unknown[]) => unknown;
	exit?: (code?: number) => never;
};

export function printAndExit(err: unknown, opts: PrintAndExitOptions = {}): never {
	const cancel = opts.cancel ?? p.cancel;
	const error = opts.error ?? console.error;
	const exit = opts.exit ?? process.exit;

	if (err instanceof UserCancelledError) {
		try {
			cancel(err.message);
		} catch {
			// nothing to clean up
		}
		return exit(err.exitCode);
	}

	// Reset clack's terminal state before we splatter raw error output
	try {
		cancel('Command failed.');
	} catch {
		// nothing to clean up
	}

	const status = getStatusCode(err);
	const body = getStatusBody(err);

	if (status !== undefined) {
		const msg = err instanceof Error ? err.message : String(err);
		error(`\nError: HTTP ${status}${msg ? ` — ${firstLine(msg)}` : ''}`);
		if (body !== undefined) {
			let bodyStr: string;
			if (typeof body === 'string') {
				try {
					bodyStr = JSON.stringify(JSON.parse(body), null, 2);
				} catch {
					bodyStr = body;
				}
			} else {
				try {
					bodyStr = JSON.stringify(body, null, 2);
				} catch {
					bodyStr = String(body);
				}
			}
			error('Body:', bodyStr);
		}
		if (err instanceof Error && err.stack) error(err.stack);
	} else if (err instanceof CliError) {
		error(`\nError: ${err.message}`);
		if (err.stack && process.env['KUBWAVE_DEBUG']) error(err.stack);
		return exit(err.exitCode);
	} else if (err instanceof Error) {
		error(`\nError: ${err.message}`);
		if (err.stack) error(err.stack);
	} else {
		error('\nError:', err);
	}

	return exit(1);
}

function firstLine(s: string): string {
	const i = s.indexOf('\n');
	return i === -1 ? s : s.slice(0, i);
}
