'use client';

import { apiData, type EnvironmentFlowLayoutNodeUpdateData } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import type { FlowLayout, FlowLayoutNode, ServiceRuntime } from '@/lib/api/types';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/token-store';
import { parseFlowLayoutEvent, removeFlowLayoutNode, upsertFlowLayoutNode } from '@/lib/flow-layout';

export const environmentServicesQuery = (environmentId: string) => ({
	queryKey: queryKeys.environmentServices(environmentId),
	queryFn: () => apiData(getBrowserApi().environments(environmentId).services.get())
});

export const flowLayoutQuery = (environmentId: string) => ({
	queryKey: queryKeys.environmentFlowLayout(environmentId),
	queryFn: () => apiData(getBrowserApi().environments(environmentId).flowLayout.get())
});

export function useEnvironmentServices(environmentId: string | undefined) {
	return useQuery({ ...environmentServicesQuery(environmentId ?? 'none'), enabled: Boolean(environmentId) });
}

// Live runtime per service, polled every 5s, keyed by service id.
export function runtimeByServiceId(entries: Array<{ serviceId: string; runtime: ServiceRuntime }>): Record<string, ServiceRuntime> {
	return Object.fromEntries(entries.map(entry => [entry.serviceId, entry.runtime]));
}

export function useEnvironmentRuntime(environmentId: string | undefined): Record<string, ServiceRuntime> {
	const { data } = useQuery({
		queryKey: queryKeys.environmentServiceStatus(environmentId ?? 'none'),
		queryFn: () => apiData(getBrowserApi().environments(environmentId!).services.status.get()),
		enabled: Boolean(environmentId),
		refetchInterval: 5000
	});
	return useMemo(() => runtimeByServiceId(data ?? []), [data]);
}

// Usage of one volume from the service's metrics; the Metrics tab shares this query. Polled slowly
// because every read collects kubelet stats from the service's nodes.
export function useVolumeUsage(serviceId: string, volumeName: string | undefined, enabled: boolean) {
	const { data } = useQuery({
		queryKey: queryKeys.serviceMetrics(serviceId, '1h'),
		queryFn: () => apiData(getBrowserApi().services(serviceId).metrics.get({ range: '1h' })),
		enabled: enabled && volumeName !== undefined,
		refetchInterval: 60_000
	});
	return data?.current.volumes.find(volume => volume.name === volumeName) ?? null;
}

export function useFlowLayout(environmentId: string | undefined) {
	return useQuery({ ...flowLayoutQuery(environmentId ?? 'none'), enabled: Boolean(environmentId) });
}

export class FlowLayoutConflict extends Error {
	constructor(readonly current: FlowLayoutNode | null) {
		super('flow_layout_conflict');
		this.name = 'FlowLayoutConflict';
	}
}

type SaveNodeBody = EnvironmentFlowLayoutNodeUpdateData['body'];

export async function saveFlowNode(environmentId: string, serviceId: string, body: SaveNodeBody): Promise<FlowLayoutNode> {
	const result = await getBrowserApi().environments(environmentId).flowLayout.nodes(serviceId).patch(body);
	if (!result.error) return result.data;
	if (result.error.status === 409)
		throw new FlowLayoutConflict((result.error.details as { current?: FlowLayoutNode | null } | undefined)?.current ?? null);
	throw new Error('failed_to_save_flow_layout');
}

export function useFlowLayoutCache(environmentId: string | undefined) {
	const queryClient = useQueryClient();
	const key = queryKeys.environmentFlowLayout(environmentId ?? 'none');
	return {
		set: (node: FlowLayoutNode) => queryClient.setQueryData<FlowLayout>(key, current => upsertFlowLayoutNode(current, node)),
		remove: (serviceId: string) => queryClient.setQueryData<FlowLayout>(key, current => removeFlowLayoutNode(current, serviceId)),
		refetch: () => queryClient.invalidateQueries({ queryKey: key })
	};
}

function socketUrl(environmentId: string): string {
	const url = new URL(`/api/environments/${environmentId}/flow-layout/ws`, window.location.href);
	url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

// Applies node moves from other sessions. Reconnects with capped backoff (reset after a healthy
// connection) and refetches the layout after a reconnect, since moves made meanwhile were missed.
// An auth rejection (close code 1008, e.g. an expired token) is retried once with a fresh token.
export function useFlowLayoutSocket(environmentId: string | undefined) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!environmentId) return;
		const layoutKey = queryKeys.environmentFlowLayout(environmentId);
		let socket: WebSocket | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		let dropped = false;

		const connect = async (attempt: number, freshToken = false) => {
			const token = freshToken ? await refreshAccessToken() : (getAccessToken() ?? (await refreshAccessToken()));
			if (!token || stopped) return;
			const ws = new WebSocket(socketUrl(environmentId));
			socket = ws;
			let ready = false;
			ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', accessToken: token })));
			ws.addEventListener('message', event => {
				const data = String(event.data);
				if (!ready && data.includes('"ready"')) {
					ready = true;
					if (dropped) void queryClient.invalidateQueries({ queryKey: layoutKey });
					return;
				}
				const node = parseFlowLayoutEvent(data, environmentId);
				if (node) queryClient.setQueryData<FlowLayout>(layoutKey, current => upsertFlowLayoutNode(current, node));
			});
			ws.addEventListener('close', event => {
				if (stopped) return;
				dropped = true;
				if (event.code === 1008) {
					if (!freshToken) void connect(0, true);
					return;
				}
				const next = ready ? 0 : attempt + 1;
				timer = setTimeout(() => void connect(next), Math.min(1000 * 2 ** next, 10_000));
			});
		};
		void connect(0);
		return () => {
			stopped = true;
			clearTimeout(timer);
			socket?.close();
		};
	}, [environmentId, queryClient]);
}

export function useDeleteService(environmentId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (serviceId: string) => apiData(getBrowserApi().services(serviceId).delete()),
		onSuccess: (_result, serviceId) => {
			const id = environmentId ?? 'none';
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(id) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentFlowLayout(id) });
			queryClient.removeQueries({ queryKey: queryKeys.service(serviceId) });
		}
	});
}

// Starts a deployment and refreshes everything that reflects deploy state.
export function useDeployService(environmentId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (serviceId: string) => apiData(getBrowserApi().services(serviceId).deployments.post()),
		onSuccess: (_deployment, serviceId) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.serviceDeployments(serviceId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServiceStatus(environmentId ?? 'none') });
		}
	});
}
