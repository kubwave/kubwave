import { describe, expect, test } from 'bun:test';
import { fallbackFlowPosition, parseFlowLayoutEvent, removeFlowLayoutNode, snapFlowPosition, upsertFlowLayoutNode } from '../lib/flow-layout';
import type { FlowLayoutNode } from '../lib/api/types';

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

describe('parseFlowLayoutEvent', () => {
	const event = {
		type: 'node_position_updated',
		environmentId: 'env-1',
		serviceId: 'svc-a',
		position: { x: 1, y: 2 },
		revision: 3,
		updatedAt: '2026-06-17T12:00:00.000Z'
	};

	test('reads a node move for the watched environment', () => {
		expect(parseFlowLayoutEvent(JSON.stringify(event), 'env-1')).toEqual({
			serviceId: 'svc-a',
			position: { x: 1, y: 2 },
			revision: 3,
			updatedAt: event.updatedAt
		});
	});

	test('ignores other environments, other message types, malformed payloads and broken JSON', () => {
		expect(parseFlowLayoutEvent(JSON.stringify(event), 'env-2')).toBeNull();
		expect(parseFlowLayoutEvent(JSON.stringify({ ...event, type: 'hello' }), 'env-1')).toBeNull();
		expect(parseFlowLayoutEvent(JSON.stringify({ ...event, position: { x: '1', y: 2 } }), 'env-1')).toBeNull();
		expect(parseFlowLayoutEvent('{not json', 'env-1')).toBeNull();
	});
});

describe('fallbackFlowPosition', () => {
	test('places unpositioned services three per row on the grid', () => {
		expect(fallbackFlowPosition(0)).toEqual({ x: 0, y: 0 });
		expect(fallbackFlowPosition(4)).toEqual({ x: 308, y: 198 });
	});
});
