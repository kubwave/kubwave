import { expect, test } from 'bun:test';
import { buildGroup } from '../features/admin-settings/build-model';

test('requires numeric limits and prevents requests above limits before save', () => {
	const draft = { ...buildGroup.initial, cpuRequest: '4', cpuLimit: '2' };
	expect(buildGroup.errors?.(draft, buildGroup.toPayload(draft))).toHaveProperty('cpuLimit');
	expect(buildGroup.toPayload({ ...buildGroup.initial, maxConcurrentBuilds: '8' }).maxConcurrentBuilds).toBe(8);
});

test('accepts decimal and plain byte memory quantities that Kubernetes accepts', () => {
	const draft = { ...buildGroup.initial, memoryRequest: '512M', memoryLimit: '2000000000' };
	expect(buildGroup.errors?.(draft, buildGroup.toPayload(draft))).toEqual({});
	const inverted = { ...buildGroup.initial, memoryRequest: '2Gi', memoryLimit: '2G' };
	expect(buildGroup.errors?.(inverted, buildGroup.toPayload(inverted))).toHaveProperty('memoryLimit');
});
