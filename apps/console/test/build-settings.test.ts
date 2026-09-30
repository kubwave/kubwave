import { expect, test } from 'bun:test';
import { buildGroup } from '../features/admin-settings/build-model';

test('requires numeric limits and prevents requests above limits before save', () => {
	const draft = { ...buildGroup.initial, cpuRequest: '4', cpuLimit: '2' };
	expect(buildGroup.errors?.(draft, buildGroup.toPayload(draft))).toHaveProperty('cpuLimit');
	expect(buildGroup.toPayload({ ...buildGroup.initial, maxConcurrentBuilds: '8' }).maxConcurrentBuilds).toBe(8);
});
