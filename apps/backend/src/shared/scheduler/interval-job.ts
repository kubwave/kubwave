export interface IntervalJob {
	stop(): void;
}

type SetIntervalFn = (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
type ClearIntervalFn = (handle: ReturnType<typeof setInterval>) => void;

export interface IntervalJobOptions {
	name: string;
	intervalMs: number;
	task: () => Promise<void>;
	enabled?: boolean;
	runImmediately?: boolean;
	unref?: boolean;
	setIntervalFn?: SetIntervalFn;
	clearIntervalFn?: ClearIntervalFn;
}

export function createIntervalJob(opts: IntervalJobOptions): IntervalJob {
	const {
		name,
		intervalMs,
		task,
		enabled = true,
		runImmediately = false,
		unref = true,
		setIntervalFn = setInterval,
		clearIntervalFn = clearInterval
	} = opts;
	if (!enabled) return { stop() {} };

	let running = false;
	const tick = async (): Promise<void> => {
		if (running) return;
		running = true;
		try {
			await task();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[${name}] tick failed: ${message}`);
		} finally {
			running = false;
		}
	};

	if (runImmediately) void tick();

	const handle = setIntervalFn(() => void tick(), intervalMs);
	if (unref && typeof handle === 'object' && handle !== null && 'unref' in handle) {
		(handle as NodeJS.Timeout).unref();
	}

	let stopped = false;
	return {
		stop() {
			if (stopped) return;
			stopped = true;
			clearIntervalFn(handle);
		}
	};
}
