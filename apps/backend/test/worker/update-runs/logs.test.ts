import { describe, expect, mock, test } from 'bun:test';
import type { V1Pod } from '@kubernetes/client-node';

// logs.ts is pure; mock db so the ~ alias import never opens a real connection.
mock.module('@kubwave/db', () => ({ db: {}, updateRuns: {} }));

const { planContainerLogs, describeFailedContainer, currentUpdatePhase } = await import('~/modules/worker/jobs/updates/logs');

// The update Job is multi-container: prepare/helm initContainers then a finalize main.
function pod(parts: { initContainers?: string[]; containers?: string[]; initStatuses?: unknown[]; statuses?: unknown[] }): V1Pod {
	return {
		spec: {
			initContainers: (parts.initContainers ?? []).map(name => ({ name })),
			containers: (parts.containers ?? []).map(name => ({ name }))
		},
		status: {
			initContainerStatuses: parts.initStatuses,
			containerStatuses: parts.statuses
		}
	} as unknown as V1Pod;
}

const running = (name: string) => ({ name, state: { running: { startedAt: '2026-06-17T00:00:00Z' } } });
const okTerminated = (name: string) => ({ name, state: { terminated: { exitCode: 0, reason: 'Completed' } } });
const badTerminated = (name: string, message?: string) => ({
	name,
	state: { terminated: { exitCode: 2, reason: 'Error', ...(message ? { message } : {}) } }
});
const waiting = (name: string, reason: string, message?: string) => ({ name, state: { waiting: { reason, ...(message ? { message } : {}) } } });

describe('planContainerLogs', () => {
	test('orders initContainers before the main container', () => {
		const plan = planContainerLogs(pod({ initContainers: ['prepare', 'helm'], containers: ['finalize'] }));
		expect(plan.map(t => t.name)).toEqual(['prepare', 'helm', 'finalize']);
	});

	test('flags a non-zero terminated container as failed and not complete', () => {
		const plan = planContainerLogs(pod({ initContainers: ['helm'], initStatuses: [badTerminated('helm', 'boom')] }));
		expect(plan[0]).toMatchObject({ name: 'helm', failed: true, complete: false, readable: true, reason: 'Error (exit 2)', message: 'boom' });
	});

	test('a clean exit-0 container is complete, not failed', () => {
		const plan = planContainerLogs(pod({ initContainers: ['prepare'], initStatuses: [okTerminated('prepare')] }));
		expect(plan[0]).toMatchObject({ name: 'prepare', failed: false, complete: true, readable: true });
		expect(plan[0]!.reason).toBeUndefined();
	});

	test('a running container is readable but neither complete nor failed', () => {
		const plan = planContainerLogs(pod({ initContainers: ['helm'], initStatuses: [running('helm')] }));
		expect(plan[0]).toMatchObject({ name: 'helm', failed: false, complete: false, readable: true });
	});

	test('a container with no status is not readable, not complete, not failed', () => {
		const plan = planContainerLogs(pod({ initContainers: ['prepare'] }));
		expect(plan[0]).toMatchObject({ name: 'prepare', failed: false, complete: false, readable: false });
	});

	test('waiting reason matching BackOff/Err/Invalid/Failed counts as failed', () => {
		const plan = planContainerLogs(pod({ containers: ['finalize'], statuses: [waiting('finalize', 'ImagePullBackOff', 'pull failed')] }));
		expect(plan[0]).toMatchObject({ name: 'finalize', failed: true, reason: 'ImagePullBackOff', message: 'pull failed' });
	});

	test('a benign waiting reason (PodInitializing) is not a failure', () => {
		const plan = planContainerLogs(pod({ containers: ['finalize'], statuses: [waiting('finalize', 'PodInitializing')] }));
		expect(plan[0]).toMatchObject({ name: 'finalize', failed: false });
		expect(plan[0]!.reason).toBeUndefined();
	});

	test('exit-0 with no reason still complete, exit-non-zero with no reason → "exit N"', () => {
		const plan = planContainerLogs(
			pod({
				initContainers: ['a', 'b'],
				initStatuses: [
					{ name: 'a', state: { terminated: { exitCode: 0 } } },
					{ name: 'b', state: { terminated: { exitCode: 137 } } }
				]
			})
		);
		expect(plan[0]).toMatchObject({ name: 'a', complete: true, failed: false });
		expect(plan[1]).toMatchObject({ name: 'b', failed: true, reason: 'exit 137' });
	});

	test('lastState.terminated makes a container readable (logs of prior attempt)', () => {
		const plan = planContainerLogs(pod({ containers: ['finalize'], statuses: [{ name: 'finalize', lastState: { terminated: { exitCode: 1 } } }] }));
		expect(plan[0]!.readable).toBe(true);
	});
});

describe('describeFailedContainer', () => {
	test('returns the first failed container as phase+message', () => {
		const p = pod({ initContainers: ['prepare', 'helm'], initStatuses: [okTerminated('prepare'), badTerminated('helm', 'helm upgrade failed')] });
		expect(describeFailedContainer(p)).toEqual({ phase: 'helm', message: 'Update container "helm" failed: Error (exit 2): helm upgrade failed' });
	});

	test('no message/reason → generic failure text', () => {
		const p = pod({ initContainers: ['helm'], initStatuses: [{ name: 'helm', state: { terminated: { exitCode: 1 } } }] });
		// exitCode 1 with no reason yields reason "exit 1"
		expect(describeFailedContainer(p)).toEqual({ phase: 'helm', message: 'Update container "helm" failed: exit 1' });
	});

	test('returns null when nothing failed', () => {
		expect(describeFailedContainer(pod({ initContainers: ['prepare'], initStatuses: [okTerminated('prepare')] }))).toBeNull();
	});
});

describe('currentUpdatePhase', () => {
	test('returns the first not-yet-complete container', () => {
		const p = pod({ initContainers: ['prepare', 'helm'], containers: ['finalize'], initStatuses: [okTerminated('prepare'), running('helm')] });
		expect(currentUpdatePhase(p)).toBe('helm');
	});

	test('returns null when every container has completed cleanly', () => {
		const p = pod({
			initContainers: ['prepare', 'helm'],
			containers: ['finalize'],
			initStatuses: [okTerminated('prepare'), okTerminated('helm')],
			statuses: [okTerminated('finalize')]
		});
		expect(currentUpdatePhase(p)).toBeNull();
	});

	test('first container with no status is treated as the current (incomplete) phase', () => {
		expect(currentUpdatePhase(pod({ initContainers: ['prepare'] }))).toBe('prepare');
	});
});
