import { afterEach, describe, expect, mock, test } from 'bun:test';

// Orchestrates settings → runtime → claim/reconcile/gc/reap. runSteps stays REAL to prove a throwing step doesn't abort the rest.

const calls: string[] = [];
let settingsThrows = false;
let claimResult: unknown[] = [];
const seenArgs: Record<string, unknown> = {};

mock.module('@kubwave/kube', () => ({ getKubeConfig: () => ({ makeApiClient: () => ({}) }) }));
mock.module('~/shared/cluster/default-domain', () => ({
	getDefaultDomainSettings: async () => {
		calls.push('getSettings');
		if (settingsThrows) throw new Error('settings read failed');
		return { mode: 'subdomain', base: 'apps.example', subdomainTemplate: '{service}' };
	},
	reconcileDefaultDomainRuntime: async () => {
		calls.push('reconcileRuntime');
		return { ingressIp: '1.2.3.4' };
	}
}));
mock.module('~/modules/worker/jobs/deployments/claim', () => ({
	claimPending: async () => {
		calls.push('claim');
		return claimResult;
	}
}));
mock.module('~/modules/worker/jobs/deployments/reconcile', () => ({
	reconcileInFlight: async (_kc: unknown, defaultDomain: unknown, runtime: unknown) => {
		calls.push('reconcile');
		seenArgs.defaultDomain = defaultDomain;
		seenArgs.runtime = runtime;
	}
}));
mock.module('~/modules/worker/jobs/deployments/tenant-gc', () => ({
	gcOrphans: async () => {
		calls.push('gc');
	}
}));
mock.module('~/modules/worker/jobs/deployments/builds/reaper', () => ({
	reapOrphanBuildJobs: async () => {
		calls.push('reap');
		throw new Error('reaper blew up'); // proves runSteps isolates a step failure
	}
}));

const { runDeploymentReconcile } = await import('~/modules/worker/jobs/deployments/job');

afterEach(() => {
	calls.length = 0;
	settingsThrows = false;
	claimResult = [];
	delete seenArgs.defaultDomain;
	delete seenArgs.runtime;
});

describe('runDeploymentReconcile', () => {
	test('runs the four steps in order after reading settings + runtime', async () => {
		claimResult = [{ id: 'd1' }];
		await runDeploymentReconcile();
		expect(calls).toEqual(['getSettings', 'reconcileRuntime', 'claim', 'reconcile', 'gc', 'reap']);
		// The runtime + (non-off) settings thread into reconcileInFlight.
		expect(seenArgs.defaultDomain).toEqual({ mode: 'subdomain', base: 'apps.example', subdomainTemplate: '{service}' });
		expect(seenArgs.runtime).toEqual({ ingressIp: '1.2.3.4' });
	});

	test('a failed settings read falls back to off-mode and still reconciles', async () => {
		settingsThrows = true;
		await runDeploymentReconcile();
		expect(calls).toEqual(['getSettings', 'reconcileRuntime', 'claim', 'reconcile', 'gc', 'reap']);
		expect(seenArgs.defaultDomain).toEqual({ mode: 'off', base: null, subdomainTemplate: null });
	});

	test('a throwing step (reaper) does not abort the tick', async () => {
		// reaper always throws here; the call simply resolves (runSteps swallows it).
		await expect(runDeploymentReconcile()).resolves.toBeUndefined();
		expect(calls).toContain('reap');
	});
});
