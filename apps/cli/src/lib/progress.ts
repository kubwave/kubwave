import * as p from '@clack/prompts';

export interface ProgressReporter {
	start(phase: string): void;
	succeed(phase: string): void;
	fail(phase: string, error: string): void;
	log(message: string): void;
	finish(status: 'succeeded' | 'failed' | 'rolled_back', message: string): void | Promise<void>;
}

export class StdoutReporter implements ProgressReporter {
	private spinner = p.spinner();
	private active = false;

	start(phase: string): void {
		// clack's spinner.start() leaks its previous interval; update in place when already spinning.
		if (this.active) {
			this.spinner.message(phase);
		} else {
			this.spinner.start(phase);
			this.active = true;
		}
	}

	succeed(phase: string): void {
		this.spinner.stop(phase);
		this.active = false;
	}

	fail(phase: string, error: string): void {
		this.spinner.error(`${phase}: ${error}`);
		this.active = false;
	}

	log(message: string): void {
		p.log.info(message);
	}

	finish(status: 'succeeded' | 'failed' | 'rolled_back', message: string): void {
		if (status === 'succeeded') {
			p.log.success(message);
		} else {
			p.log.error(message);
		}
	}
}

export class DbReporter implements ProgressReporter {
	private updateStatus: (status: string, phase: string, error?: string) => Promise<void>;

	constructor(updateStatus: (status: string, phase: string, error?: string) => Promise<void>) {
		this.updateStatus = updateStatus;
	}

	start(phase: string): void {
		this.updateStatus('running', phase).catch(console.error);
		console.log(`[update] ${phase}`);
	}

	succeed(phase: string): void {
		this.updateStatus('running', phase).catch(console.error);
		console.log(`[update] ✓ ${phase}`);
	}

	fail(phase: string, error: string): void {
		this.updateStatus('failed', phase, error).catch(console.error);
		console.error(`[update] ✗ ${phase}: ${error}`);
	}

	log(message: string): void {
		console.log(`[update] ${message}`);
	}

	// MUST be awaited: the finalize container tears down the DB right after, racing a fire-and-forget write.
	async finish(status: 'succeeded' | 'failed' | 'rolled_back', message: string): Promise<void> {
		try {
			await this.updateStatus(status, 'done', status !== 'succeeded' ? message : undefined);
		} catch (err) {
			console.error(err);
		}
		console.log(`[update] ${status}: ${message}`);
	}
}
