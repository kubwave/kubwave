import { describe, expect, test } from 'bun:test';
import { runtimeClassForService } from '~/modules/worker/jobs/deployments/deployers/runtime/runtime-class';

describe('runtimeClassForService', () => {
	test('managed database engines are exempt (no sandbox), even when a default is set', () => {
		for (const engine of ['postgres', 'mysql', 'mariadb', 'mongodb']) {
			expect(runtimeClassForService(engine, 'gvisor')).toBe('');
		}
	});

	test('user-supplied services get the default runtime class', () => {
		for (const t of ['docker-image', 'dockerfile', 'public-repo', 'private-repo']) {
			expect(runtimeClassForService(t, 'gvisor')).toBe('gvisor');
		}
	});

	test('an empty default means no sandbox for anyone', () => {
		expect(runtimeClassForService('docker-image', '')).toBe('');
	});
});
