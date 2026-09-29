import type { FlowLayout, FlowLayoutNode, FlowNodePosition } from '@/lib/api/types';

// Positions are persisted snapped to this grid, so it must stay in sync with stored layouts.
export const FLOW_GRID_SIZE = 22;
const FALLBACK_COL_WIDTH = 308;
const FALLBACK_ROW_HEIGHT = 198;

const normalizeZero = (value: number) => (Object.is(value, -0) ? 0 : value);

export function snapFlowPosition(position: FlowNodePosition): FlowNodePosition {
	return {
		x: normalizeZero(FLOW_GRID_SIZE * Math.round(position.x / FLOW_GRID_SIZE)),
		y: normalizeZero(FLOW_GRID_SIZE * Math.round(position.y / FLOW_GRID_SIZE))
	};
}

// Where a service without a stored position goes: three per row.
export function fallbackFlowPosition(index: number): FlowNodePosition {
	return snapFlowPosition({ x: (index % 3) * FALLBACK_COL_WIDTH, y: Math.floor(index / 3) * FALLBACK_ROW_HEIGHT });
}

export function upsertFlowLayoutNode(layout: FlowLayout | undefined, node: FlowLayoutNode): FlowLayout {
	const nodes = layout?.nodes ?? [];
	const existing = nodes.findIndex(entry => entry.serviceId === node.serviceId);
	if (existing === -1) return { nodes: [...nodes, node] };
	return { nodes: nodes.map((entry, index) => (index === existing ? node : entry)) };
}

export function removeFlowLayoutNode(layout: FlowLayout | undefined, serviceId: string): FlowLayout {
	return { nodes: (layout?.nodes ?? []).filter(node => node.serviceId !== serviceId) };
}

type NodeMovedEvent = FlowLayoutNode & { type: 'node_position_updated'; environmentId: string };

function isNodeMovedEvent(value: unknown): value is NodeMovedEvent {
	if (typeof value !== 'object' || value === null) return false;
	const event = value as Partial<NodeMovedEvent>;
	return (
		event.type === 'node_position_updated' &&
		typeof event.environmentId === 'string' &&
		typeof event.serviceId === 'string' &&
		typeof event.position?.x === 'number' &&
		typeof event.position?.y === 'number' &&
		typeof event.revision === 'number' &&
		typeof event.updatedAt === 'string'
	);
}

// A node move pushed over the flow-layout WebSocket, or null for anything else.
export function parseFlowLayoutEvent(data: string, environmentId: string): FlowLayoutNode | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}
	if (!isNodeMovedEvent(parsed) || parsed.environmentId !== environmentId) return null;
	return { serviceId: parsed.serviceId, position: parsed.position, revision: parsed.revision, updatedAt: parsed.updatedAt };
}
