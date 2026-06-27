import { describe, expect, test } from 'bun:test';
import { removeFlowLayoutNode, snapFlowPosition, upsertFlowLayoutNode } from '~/composables/use-flow-layout';
import type { FlowLayoutNode } from '~/utils/types';

const node = (serviceId: string, x: number, revision: number): FlowLayoutNode => ({
	serviceId,
	position: { x, y: x + 10 },
	revision,
	updatedAt: `2026-06-17T12:00:0${revision}.000Z`
});

describe('flow layout cache helpers', () => {
	test('snaps positions to the visible service flow grid', () => {
		expect(snapFlowPosition({ x: 31, y: 54 })).toEqual({ x: 22, y: 44 });
		expect(snapFlowPosition({ x: 33, y: 55 })).toEqual({ x: 44, y: 66 });
	});

	test('snaps negative positions around zero', () => {
		expect(snapFlowPosition({ x: -10, y: -12 })).toEqual({ x: 0, y: -22 });
		expect(snapFlowPosition({ x: -34, y: -55 })).toEqual({ x: -44, y: -44 });
	});

	test('adds a node to an empty layout', () => {
		expect(upsertFlowLayoutNode(undefined, node('svc-a', 10, 1))).toEqual({
			nodes: [node('svc-a', 10, 1)]
		});
	});

	test('replaces an existing node without moving other nodes', () => {
		const layout = { nodes: [node('svc-a', 10, 1), node('svc-b', 30, 1)] };
		expect(upsertFlowLayoutNode(layout, node('svc-a', 50, 2))).toEqual({
			nodes: [node('svc-a', 50, 2), node('svc-b', 30, 1)]
		});
	});

	test('removes a node after a null conflict response', () => {
		const layout = { nodes: [node('svc-a', 10, 1), node('svc-b', 30, 1)] };
		expect(removeFlowLayoutNode(layout, 'svc-a')).toEqual({
			nodes: [node('svc-b', 30, 1)]
		});
	});
});
