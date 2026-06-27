import { describe, expect, test } from 'bun:test';
import type { V1Deployment, V1DeploymentCondition } from '@kubernetes/client-node';
import { deploymentRolloutState, deploymentRuntimeStatus, SERVICE_ROLLOUT_FAILURE_GRACE_SECONDS } from '@kubwave/kube';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function secondsAgo(seconds: number): Date {
	return new Date(NOW.getTime() - seconds * 1000);
}

function progressDeadlineCondition(secondsSinceTransition: number): V1DeploymentCondition {
	return {
		type: 'Progressing',
		status: 'False',
		reason: 'ProgressDeadlineExceeded',
		message: 'ReplicaSet has timed out progressing.',
		lastTransitionTime: secondsAgo(secondsSinceTransition)
	};
}

function deployment(status: V1Deployment['status']): V1Deployment {
	return {
		apiVersion: 'apps/v1',
		kind: 'Deployment',
		metadata: { name: 'svc-test', generation: 1 },
		spec: { replicas: 1, selector: { matchLabels: { app: 'test' } }, template: { metadata: { labels: { app: 'test' } }, spec: { containers: [] } } },
		status: { observedGeneration: 1, replicas: 1, ...status }
	};
}

describe('deploymentRolloutState deadline grace', () => {
	test('keeps a ProgressDeadlineExceeded rollout active during the grace window', () => {
		const dep = deployment({ updatedReplicas: 1, readyReplicas: 0, availableReplicas: 0, conditions: [progressDeadlineCondition(10)] });

		expect(deploymentRolloutState(dep, NOW)).toBe('progressing');
		expect(deploymentRuntimeStatus(dep, NOW).status).toBe('progressing');
	});

	test('fails a ProgressDeadlineExceeded rollout after the grace window', () => {
		const dep = deployment({
			updatedReplicas: 1,
			readyReplicas: 0,
			availableReplicas: 0,
			conditions: [progressDeadlineCondition(SERVICE_ROLLOUT_FAILURE_GRACE_SECONDS + 1)]
		});

		expect(deploymentRolloutState(dep, NOW)).toBe('failed');
		expect(deploymentRuntimeStatus(dep, NOW).status).toBe('failed');
	});

	test('treats ready replicas as successful even if the deadline condition lingers', () => {
		const dep = deployment({
			updatedReplicas: 1,
			readyReplicas: 1,
			availableReplicas: 1,
			conditions: [progressDeadlineCondition(SERVICE_ROLLOUT_FAILURE_GRACE_SECONDS + 30)]
		});

		expect(deploymentRolloutState(dep, NOW)).toBe('ready');
		expect(deploymentRuntimeStatus(dep, NOW).status).toBe('running');
	});
});
