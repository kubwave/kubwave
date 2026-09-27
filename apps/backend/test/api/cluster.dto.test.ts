import { describe, expect, test } from 'bun:test';
import { clusterNodeParamsSchema } from '~/modules/platform/cluster/cluster.dto';

// The node services interpolate the validated name into field selectors and PromQL, so this schema is their only guard.
describe('clusterNodeParamsSchema', () => {
	test.each(['k3d-kubwave-server-0', 'ip-10-0-1-23.eu-central-1.compute.internal', 'a'])('accepts the node name %s', name => {
		expect(clusterNodeParamsSchema.safeParse({ name }).success).toBe(true);
	});

	test.each([
		'x") or vector(1) or ("y',
		'node"}',
		'node\\',
		'node,involvedObject.kind=Pod',
		'node=x',
		'node!=x',
		'node x',
		'Node-1',
		'-node',
		'node.',
		''
	])('rejects %p before it can reach a selector or query', name => {
		expect(clusterNodeParamsSchema.safeParse({ name }).success).toBe(false);
	});
});
