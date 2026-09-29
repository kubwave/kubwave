import { describe, expect, test } from 'bun:test';
import {
	isTerminalUpdateStatus,
	updateRunPollInterval,
	updateRunStatusLabel,
	updateRunStatusMeta,
	updateRunTitle
} from '../features/admin-settings/update-runs';

describe('update runs', () => {
	test('succeeded, failed and rolled back runs are terminal', () => {
		expect(['succeeded', 'failed', 'rolled_back'].every(isTerminalUpdateStatus)).toBe(true);
		expect(isTerminalUpdateStatus('running')).toBe(false);
		expect(isTerminalUpdateStatus(undefined)).toBe(false);
	});

	test('polls every 2s until the run is terminal', () => {
		expect(updateRunPollInterval('pending')).toBe(2000);
		expect(updateRunPollInterval(undefined)).toBe(2000);
		expect(updateRunPollInterval('rolled_back')).toBe(false);
	});

	test('labels a running run by its phase', () => {
		expect(updateRunStatusLabel({ status: 'running', phase: 'helm-upgrade' })).toBe('Applying platform upgrade');
		expect(updateRunStatusLabel({ status: 'running', phase: 'custom-step' })).toBe('custom-step');
		expect(updateRunStatusLabel({ status: 'rolled_back', phase: null })).toBe('Update failed — rollback performed');
		expect(updateRunStatusLabel(undefined)).toBe('Unknown status');
	});

	test('unknown statuses fall back to a neutral badge', () => {
		expect(updateRunStatusMeta('running')).toMatchObject({ label: 'Running', spin: true });
		expect(updateRunStatusMeta('weird').label).toBe('Unknown');
	});

	test('titles version updates by their versions and port pool runs by kind', () => {
		expect(updateRunTitle({ kind: 'version', fromVersion: '1.0.0', toVersion: '1.1.0' })).toBe('1.0.0 → 1.1.0');
		expect(updateRunTitle({ kind: 'tcp_port_pool', fromVersion: '1.0.0', toVersion: '1.0.0' })).toBe('TCP port pool');
	});
});
