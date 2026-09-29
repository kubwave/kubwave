'use client';

import { apiData, type McpAccessInputDto } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';

export function useMcpInfo() {
	return useQuery({ queryKey: queryKeys.mcpInfo, queryFn: () => apiData(getBrowserApi().mcp.info.get()) });
}

export function useMcpAccess() {
	const queryClient = useQueryClient();
	const onSuccess = () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpAccess });
	const entries = useQuery({ queryKey: queryKeys.mcpAccess, queryFn: () => apiData(getBrowserApi().mcp.access.get()) });
	const create = useMutation({ mutationFn: (input: McpAccessInputDto) => apiData(getBrowserApi().mcp.access.post(input)), onSuccess });
	const revoke = useMutation({ mutationFn: (accessId: string) => apiData(getBrowserApi().mcp.access(accessId).delete()), onSuccess });
	return { entries, create, revoke };
}
