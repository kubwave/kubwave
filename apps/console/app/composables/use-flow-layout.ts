import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { EnvironmentFlowLayoutNodeUpdateData } from '@kubwave/api-client';
import { apiData, type ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';
import { getAccessToken, refreshAccessToken } from '~/utils/token-store';
import type { FlowLayout, FlowLayoutNode, FlowNodePosition } from '~/utils/types';

type UpdateFlowNodeJson = EnvironmentFlowLayoutNodeUpdateData['body'];

interface FlowLayoutSocketNodeEvent extends FlowLayoutNode {
	type: 'node_position_updated';
	environmentId: string;
	clientMutationId?: string;
}

export class FlowLayoutConflict extends Error {
	constructor(public readonly current: FlowLayoutNode | null) {
		super('flow_layout_conflict');
		this.name = 'FlowLayoutConflict';
	}
}

export const FLOW_LAYOUT_GRID_SIZE = 22;
export const FLOW_LAYOUT_SNAP_GRID: [number, number] = [FLOW_LAYOUT_GRID_SIZE, FLOW_LAYOUT_GRID_SIZE];

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

export function snapFlowPosition(position: FlowNodePosition): FlowNodePosition {
	return {
		x: normalizeZero(FLOW_LAYOUT_GRID_SIZE * Math.round(position.x / FLOW_LAYOUT_GRID_SIZE)),
		y: normalizeZero(FLOW_LAYOUT_GRID_SIZE * Math.round(position.y / FLOW_LAYOUT_GRID_SIZE))
	};
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

export async function fetchEnvironmentFlowLayout(api: ApiClient, environmentId: string): Promise<FlowLayout> {
	return apiData(api.environments(environmentId).flowLayout.get()).catch(() => {
		throw new Error('failed_to_load_flow_layout');
	});
}

export function useEnvironmentFlowLayout(environmentId: MaybeRefOrGetter<string | null | undefined>) {
	const api = useApi();

	return useQuery({
		queryKey: computed(() => queryKeys.environmentFlowLayout(toValue(environmentId) ?? 'none')),
		enabled: computed(() => Boolean(toValue(environmentId))),
		queryFn: () => fetchEnvironmentFlowLayout(api, toValue(environmentId)!)
	});
}

export async function saveFlowNodePosition(
	api: ApiClient,
	environmentId: string,
	serviceId: string,
	json: UpdateFlowNodeJson
): Promise<FlowLayoutNode> {
	const res = await api.environments(environmentId).flowLayout.nodes(serviceId).patch(json);

	if (res.error) {
		if (res.error.status === 409) {
			const details = res.error.details as { current?: FlowLayoutNode | null } | undefined;
			throw new FlowLayoutConflict(details?.current ?? null);
		}
		throw new Error('failed_to_save_flow_layout');
	}
	return res.data;
}

function isNodeUpdatedEvent(value: unknown): value is FlowLayoutSocketNodeEvent {
	if (typeof value !== 'object' || value === null) return false;
	const event = value as Partial<FlowLayoutSocketNodeEvent>;
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

function flowLayoutSocketUrl(environmentId: string): string {
	const url = new URL(`/api/environments/${environmentId}/flow-layout/ws`, window.location.href);
	url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

export function useEnvironmentFlowLayoutSocket(environmentId: MaybeRefOrGetter<string | null | undefined>) {
	if (import.meta.server) return;

	const queryClient = useQueryClient();
	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;

	function stop() {
		generation++;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = null;
		socket?.close();
		socket = null;
	}

	async function connect(environmentIdValue: string, currentGeneration: number, attempt = 0) {
		const token = getAccessToken() ?? (await refreshAccessToken());
		if (!token || currentGeneration !== generation) return;

		const ws = new WebSocket(flowLayoutSocketUrl(environmentIdValue));
		socket = ws;

		ws.addEventListener('open', () => {
			ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
		});

		ws.addEventListener('message', event => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (!isNodeUpdatedEvent(parsed) || parsed.environmentId !== environmentIdValue) return;
			queryClient.setQueryData<FlowLayout>(queryKeys.environmentFlowLayout(environmentIdValue), current =>
				upsertFlowLayoutNode(current, {
					serviceId: parsed.serviceId,
					position: parsed.position,
					revision: parsed.revision,
					updatedAt: parsed.updatedAt
				})
			);
		});

		ws.addEventListener('close', event => {
			if (currentGeneration !== generation || event.code === 1008) return;
			const delay = Math.min(1000 * 2 ** attempt, 10_000);
			reconnectTimer = setTimeout(() => void connect(environmentIdValue, currentGeneration, attempt + 1), delay);
		});
	}

	watch(
		() => toValue(environmentId),
		id => {
			stop();
			if (!id) return;
			const currentGeneration = generation;
			void connect(id, currentGeneration);
		},
		{ immediate: true }
	);

	onScopeDispose(stop);
}
