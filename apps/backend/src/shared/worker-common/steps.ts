import { errorMessage } from './errors.js';

export interface JobStep {
	name: string;
	run: () => Promise<void>;
}

// Run steps in order, isolating each: a step that throws is logged and the next still runs.
// NOTE: failure log is normalized to `[<prefix>] <name> failed:` (was "pass failed").
export async function runSteps(prefix: string, steps: JobStep[]): Promise<void> {
	for (const step of steps) {
		try {
			await step.run();
		} catch (err) {
			console.warn(`[${prefix}] ${step.name} failed:`, errorMessage(err));
		}
	}
}
