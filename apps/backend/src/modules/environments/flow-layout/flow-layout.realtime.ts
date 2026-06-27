import { sql } from '@kubwave/db';
import type { WebSocket } from '@fastify/websocket';
import type { FlowLayoutNodeUpdatedEvent } from './flow-layout.dto.js';

const FLOW_LAYOUT_CHANNEL = 'kubwave_flow_layout_events';

const clientsByEnvironment = new Map<string, Set<WebSocket>>();
let listening = false;

function sendJson(socket: WebSocket, payload: unknown): void {
	if (socket.readyState !== 1) return;
	socket.send(JSON.stringify(payload));
}

export function registerFlowLayoutSocket(environmentId: string, socket: WebSocket): () => void {
	let clients = clientsByEnvironment.get(environmentId);
	if (!clients) {
		clients = new Set();
		clientsByEnvironment.set(environmentId, clients);
	}

	clients.add(socket);

	return () => {
		clients?.delete(socket);
		if (clients?.size === 0) clientsByEnvironment.delete(environmentId);
	};
}

export function broadcastFlowLayoutEvent(event: FlowLayoutNodeUpdatedEvent): void {
	const clients = clientsByEnvironment.get(event.environmentId);
	if (!clients) return;

	for (const socket of clients) {
		sendJson(socket, event);
	}
}

export function startFlowLayoutNotifications(): void {
	if (listening) return;
	listening = true;

	void sql
		.listen(FLOW_LAYOUT_CHANNEL, payload => {
			const event = parseFlowLayoutEvent(payload);
			if (event) broadcastFlowLayoutEvent(event);
		})
		.catch(err => {
			listening = false;
			console.warn('[flow-layout] postgres LISTEN failed', err);
		});
}

export async function publishFlowLayoutEvent(event: FlowLayoutNodeUpdatedEvent): Promise<void> {
	await sql.notify(FLOW_LAYOUT_CHANNEL, JSON.stringify(event));
}

function parseFlowLayoutEvent(payload: string): FlowLayoutNodeUpdatedEvent | null {
	try {
		const parsed = JSON.parse(payload) as Partial<FlowLayoutNodeUpdatedEvent>;
		if (
			parsed.type !== 'node_position_updated' ||
			typeof parsed.environmentId !== 'string' ||
			typeof parsed.serviceId !== 'string' ||
			typeof parsed.position?.x !== 'number' ||
			typeof parsed.position?.y !== 'number' ||
			typeof parsed.revision !== 'number' ||
			typeof parsed.updatedAt !== 'string'
		) {
			return null;
		}
		return parsed as FlowLayoutNodeUpdatedEvent;
	} catch {
		return null;
	}
}
