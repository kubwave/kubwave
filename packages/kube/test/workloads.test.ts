import { describe, expect, test } from 'bun:test';
import type { V1Deployment } from '@kubernetes/client-node';
import {
	deploymentRolloutState,
	deploymentRuntimeStatus,
	environmentNamespace,
	fileKey,
	internalServiceName,
	LABEL_SERVICE_ID,
	pvcName,
	resourceName,
	secretName,
	SERVICE_ROLLOUT_FAILURE_GRACE_SECONDS,
	SERVICE_ROLLOUT_PROGRESS_DEADLINE_SECONDS,
	selectorLabels,
	unknownRuntime
} from '../src/workloads/index';

const NOW = new Date('2026-06-17T12:00:00.000Z');

// Build a Deployment fixture from partial spec/status/metadata; defaults to a freshly-created deployment.
function dep(opts: {
	generation?: number;
	replicas?: number;
	observedGeneration?: number;
	updatedReplicas?: number;
	readyReplicas?: number;
	availableReplicas?: number;
	statusReplicas?: number;
	conditions?: { type: string; status: string; reason?: string; lastTransitionTime?: string | Date }[];
	noStatus?: boolean;
}): V1Deployment {
	return {
		metadata: { generation: opts.generation ?? 1 },
		spec: { replicas: opts.replicas ?? 1 },
		status: opts.noStatus
			? undefined
			: {
					observedGeneration: opts.observedGeneration ?? 1,
					updatedReplicas: opts.updatedReplicas,
					readyReplicas: opts.readyReplicas,
					availableReplicas: opts.availableReplicas,
					replicas: opts.statusReplicas,
					conditions: opts.conditions
				}
	} as unknown as V1Deployment;
}

// A condition that trips the product-level failure grace; transitionedSecondsAgo is how long ago the deadline was exceeded relative to NOW.
function deadlineExceeded(transitionedSecondsAgo: number | null) {
	return {
		type: 'Progressing',
		status: 'False',
		reason: 'ProgressDeadlineExceeded',
		lastTransitionTime: transitionedSecondsAgo == null ? undefined : new Date(NOW.getTime() - transitionedSecondsAgo * 1000).toISOString()
	};
}

describe('naming helpers', () => {
	test('environmentNamespace prefixes the env id', () => {
		expect(environmentNamespace('abc123')).toBe('kubwave-env-abc123');
	});

	test('resourceName prefixes the service id', () => {
		expect(resourceName('s1')).toBe('svc-s1');
	});

	test('pvcName joins service id and volume name', () => {
		expect(pvcName('s1', 'data')).toBe('svc-s1-data');
	});

	test('secretName is the per-service env secret', () => {
		expect(secretName('s1')).toBe('svc-s1-env');
	});

	test('internalServiceName equals resourceName', () => {
		expect(internalServiceName('s1')).toBe('svc-s1');
		expect(internalServiceName('s1')).toBe(resourceName('s1'));
	});

	test('fileKey maps an absolute path to a valid Secret data key', () => {
		expect(fileKey('/home/kong/kong.yml')).toBe('home_kong_kong.yml');
		expect(fileKey('/docker-entrypoint-initdb.d/01-roles.sql')).toBe('docker-entrypoint-initdb.d_01-roles.sql');
	});

	test('fileKey is not injective — distinct paths can collide (callers must guard)', () => {
		expect(fileKey('/a/b')).toBe(fileKey('/a_b'));
	});
});

describe('selectorLabels', () => {
	test('maps the service-id label to the id', () => {
		expect(selectorLabels('s1')).toEqual({ [LABEL_SERVICE_ID]: 's1' });
		expect(selectorLabels('s1')).toEqual({ 'kubwave/service-id': 's1' });
	});
});

describe('unknownRuntime', () => {
	test('is an all-zero runtime tagged unknown', () => {
		// "couldn't read the cluster" sentinel.
		expect(unknownRuntime()).toEqual({ status: 'unknown', readyReplicas: 0, desiredReplicas: 0, updatedReplicas: 0, availableReplicas: 0 });
	});
});

describe('rollout constants', () => {
	test('deadline and grace match the documented values', () => {
		// Tests below depend on these exact boundaries.
		expect(SERVICE_ROLLOUT_PROGRESS_DEADLINE_SECONDS).toBe(300);
		expect(SERVICE_ROLLOUT_FAILURE_GRACE_SECONDS).toBe(60);
	});
});

describe('deploymentRolloutState', () => {
	test('observedGeneration lag → progressing (early return before readiness gates)', () => {
		// Controller hasn't seen the latest spec; readiness counts are irrelevant.
		const d = dep({
			generation: 2,
			observedGeneration: 1,
			replicas: 1,
			updatedReplicas: 1,
			readyReplicas: 1,
			availableReplicas: 1,
			statusReplicas: 1
		});
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('all replicas updated/ready/available and not over-provisioned → ready', () => {
		// The success gate.
		const d = dep({ replicas: 2, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2, statusReplicas: 2 });
		expect(deploymentRolloutState(d, NOW)).toBe('ready');
	});

	test('default desired is 1 when spec.replicas is absent', () => {
		// desired falls back to 1; a single ready replica satisfies the gate.
		const d = {
			metadata: { generation: 1 },
			spec: {},
			status: { observedGeneration: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, replicas: 1 }
		} as unknown as V1Deployment;
		expect(deploymentRolloutState(d, NOW)).toBe('ready');
	});

	test('surplus replicas (total > desired) blocks ready → progressing', () => {
		// Old pods still terminating during a rollout (total <= desired gate fails).
		const d = dep({ replicas: 2, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2, statusReplicas: 3 });
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('not enough ready replicas, no deadline condition → progressing', () => {
		// Mid-rollout with healthy progress.
		const d = dep({ replicas: 2, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, statusReplicas: 1 });
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('null/empty status → progressing (all counts default to 0)', () => {
		// Brand-new deployment with no status yet.
		const d = dep({ noStatus: true });
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('ProgressDeadlineExceeded past the grace window → failed', () => {
		// 61s ago > 60s grace ⇒ finalized as failed.
		const d = dep({ replicas: 1, readyReplicas: 0, conditions: [deadlineExceeded(61)] });
		expect(deploymentRolloutState(d, NOW)).toBe('failed');
	});

	test('ProgressDeadlineExceeded exactly at the grace boundary → failed (>=)', () => {
		// 60s == grace; boundary is inclusive.
		const d = dep({ replicas: 1, readyReplicas: 0, conditions: [deadlineExceeded(60)] });
		expect(deploymentRolloutState(d, NOW)).toBe('failed');
	});

	test('ProgressDeadlineExceeded within the grace window → still progressing', () => {
		// 59s < 60s grace ⇒ give the pod a chance to come up.
		const d = dep({ replicas: 1, readyReplicas: 0, conditions: [deadlineExceeded(59)] });
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('ProgressDeadlineExceeded with no lastTransitionTime → progressing (no usable timestamp)', () => {
		// Can't tell how long ago it tripped ⇒ stay in grace.
		const d = dep({ replicas: 1, readyReplicas: 0, conditions: [deadlineExceeded(null)] });
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('ProgressDeadlineExceeded with unparseable lastTransitionTime → progressing', () => {
		// Date.parse → NaN ⇒ no usable timestamp ⇒ grace.
		const d = dep({
			replicas: 1,
			readyReplicas: 0,
			conditions: [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', lastTransitionTime: 'not-a-date' }]
		});
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('Progressing/False with a different reason is not a deadline failure → progressing', () => {
		// Only ProgressDeadlineExceeded counts; ReplicaSetUpdated etc. do not.
		const d = dep({
			replicas: 1,
			readyReplicas: 0,
			conditions: [
				{ type: 'Progressing', status: 'False', reason: 'SomethingElse', lastTransitionTime: new Date(NOW.getTime() - 600_000).toISOString() }
			]
		});
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('Progressing/True/ProgressDeadlineExceeded (status not False) → progressing', () => {
		// reason matches but status is True ⇒ not a final failure.
		const d = dep({
			replicas: 1,
			readyReplicas: 0,
			conditions: [
				{ type: 'Available', status: 'True', reason: 'ProgressDeadlineExceeded', lastTransitionTime: new Date(NOW.getTime() - 600_000).toISOString() }
			]
		});
		expect(deploymentRolloutState(d, NOW)).toBe('progressing');
	});

	test('lastTransitionTime accepts a Date instance (not just a string)', () => {
		// timeMs handles Date directly; past-grace ⇒ failed.
		const d = {
			metadata: { generation: 1 },
			spec: { replicas: 1 },
			status: {
				observedGeneration: 1,
				readyReplicas: 0,
				conditions: [
					{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', lastTransitionTime: new Date(NOW.getTime() - 120_000) }
				]
			}
		} as unknown as V1Deployment;
		expect(deploymentRolloutState(d, NOW)).toBe('failed');
	});

	test('uses default now=new Date() when omitted (does not throw)', () => {
		// Real-time path: a fully-ready deployment is ready regardless of clock.
		const d = dep({ replicas: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, statusReplicas: 1 });
		expect(deploymentRolloutState(d)).toBe('ready');
	});
});

describe('deploymentRuntimeStatus', () => {
	test('null deployment → not_deployed with zeroed counts', () => {
		// No Deployment object exists yet.
		expect(deploymentRuntimeStatus(null, NOW)).toEqual({
			status: 'not_deployed',
			readyReplicas: 0,
			desiredReplicas: 0,
			updatedReplicas: 0,
			availableReplicas: 0
		});
	});

	test('desired 0 → stopped (scaled to zero) regardless of rollout', () => {
		// Intentional scale-to-zero short-circuits before rollout state.
		expect(deploymentRuntimeStatus(dep({ replicas: 0 }), NOW)).toEqual({
			status: 'stopped',
			readyReplicas: 0,
			desiredReplicas: 0,
			updatedReplicas: 0,
			availableReplicas: 0
		});
	});

	test('rollout failed → failed, carrying live counts', () => {
		// Maps the terminal rollout state and reports the current replica counts.
		const d = dep({
			replicas: 2,
			readyReplicas: 1,
			updatedReplicas: 1,
			availableReplicas: 1,
			statusReplicas: 2,
			conditions: [deadlineExceeded(120)]
		});
		expect(deploymentRuntimeStatus(d, NOW)).toEqual({
			status: 'failed',
			readyReplicas: 1,
			desiredReplicas: 2,
			updatedReplicas: 1,
			availableReplicas: 1
		});
	});

	test('rollout ready → running', () => {
		// Healthy fully-rolled-out deployment.
		const d = dep({ replicas: 2, readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2, statusReplicas: 2 });
		expect(deploymentRuntimeStatus(d, NOW)).toEqual({
			status: 'running',
			readyReplicas: 2,
			desiredReplicas: 2,
			updatedReplicas: 2,
			availableReplicas: 2
		});
	});

	test('observedGeneration lag → progressing', () => {
		// Controller hasn't observed the latest spec.
		const d = dep({
			generation: 3,
			observedGeneration: 1,
			replicas: 1,
			readyReplicas: 1,
			updatedReplicas: 1,
			availableReplicas: 1,
			statusReplicas: 1
		});
		expect(deploymentRuntimeStatus(d, NOW).status).toBe('progressing');
	});

	test('updatedReplicas < desired (no deadline) → progressing', () => {
		// New replicas not all rolled out yet.
		const d = dep({ replicas: 3, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, statusReplicas: 1 });
		expect(deploymentRuntimeStatus(d, NOW).status).toBe('progressing');
	});

	test('all updated, ready & available >= desired (total surplus blocks rollout ready) → running', () => {
		// rollout=progressing (total>desired) but the ready/available gate still flags running.
		const d = dep({ replicas: 2, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2, statusReplicas: 3 });
		expect(deploymentRuntimeStatus(d, NOW).status).toBe('running');
	});

	test('all updated, some but not all ready → degraded', () => {
		// updated==desired, readyReplicas>0 but < desired (and surplus keeps rollout!=ready).
		const d = dep({ replicas: 2, updatedReplicas: 2, readyReplicas: 1, availableReplicas: 1, statusReplicas: 3 });
		expect(deploymentRuntimeStatus(d, NOW).status).toBe('degraded');
	});

	test('all updated, zero ready, none available → progressing (final fall-through)', () => {
		// updated==desired but nothing ready yet; not degraded.
		const d = dep({ replicas: 2, updatedReplicas: 2, readyReplicas: 0, availableReplicas: 0, statusReplicas: 3 });
		expect(deploymentRuntimeStatus(d, NOW).status).toBe('progressing');
	});

	test('null/empty status with desired 1 → progressing', () => {
		// Brand-new deployment: updated 0 < 1.
		expect(deploymentRuntimeStatus(dep({ noStatus: true }), NOW).status).toBe('progressing');
	});

	test('uses default now=new Date() when omitted', () => {
		// Real-time path on a healthy deployment.
		const d = dep({ replicas: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, statusReplicas: 1 });
		expect(deploymentRuntimeStatus(d).status).toBe('running');
	});
});
