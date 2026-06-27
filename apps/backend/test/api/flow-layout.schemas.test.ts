import { describe, expect, test } from 'bun:test';
import { updateFlowLayoutNodeSchema } from '~/modules/environments/flow-layout/flow-layout.dto';
import { FlowLayoutConflictError } from '~/modules/environments/flow-layout/flow-layout.errors';
import type { FlowLayoutNodeDto } from '~/modules/environments/flow-layout/flow-layout.dto';

// Note: the old flowLayoutSchema (zod parse of the persisted node list) is gone — the layout is now
// the FlowLayoutDto class. The conflict shape moved from a zod schema to the FlowLayoutConflictError.
describe('flow layout schemas', () => {
	test('requires create writes to use a null base revision', () => {
		expect(updateFlowLayoutNodeSchema.parse({ position: { x: 1, y: 2 }, baseRevision: null })).toEqual({
			position: { x: 1, y: 2 },
			baseRevision: null
		});
	});

	test('rejects impossible coordinates and non-positive revisions', () => {
		expect(updateFlowLayoutNodeSchema.safeParse({ position: { x: 1_000_000, y: 0 }, baseRevision: null }).success).toBe(false);
		expect(updateFlowLayoutNodeSchema.safeParse({ position: { x: 0, y: 0 }, baseRevision: 0 }).success).toBe(false);
	});

	test('conflict error carries the 409 ApiError shape with the current node', () => {
		const current: FlowLayoutNodeDto = {
			serviceId: '11111111-1111-4111-8111-111111111111',
			position: { x: 10, y: 20 },
			revision: 3,
			updatedAt: '2026-06-17T12:00:00.000Z'
		};

		const error = new FlowLayoutConflictError(current);

		expect(error.status).toBe(409);
		expect(error.code).toBe('flow_layout_conflict');
		expect((error.details as { current: FlowLayoutNodeDto }).current.revision).toBe(3);
	});
});
