import { describe, expect, it } from 'bun:test';
import { BUILD_ACTIVE_STATUSES, RECONCILE_IN_FLIGHT_STATUSES } from '~/modules/worker/jobs/deployments/types';

describe('deployment status sets', () => {
	it('BUILD_ACTIVE_STATUSES includes pending (a pending build can still push)', () => {
		expect([...BUILD_ACTIVE_STATUSES].sort()).toEqual(['canceling', 'deploying', 'pending']);
	});
	it('RECONCILE_IN_FLIGHT_STATUSES excludes pending (claimed separately)', () => {
		expect([...RECONCILE_IN_FLIGHT_STATUSES].sort()).toEqual(['canceling', 'deploying']);
	});
});
