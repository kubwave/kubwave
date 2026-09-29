'use client';

import { apiData } from '@kubwave/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import type { ClusterSnapshot } from '@/lib/api/types';
import { pollIntervalForRange, type MetricsRange } from '@/lib/metrics-chart';
import { appendLiveSample, emptyLiveSeries } from './model';

export function useClusterSnapshot() {
	return useQuery({
		queryKey: queryKeys.clusterSnapshot,
		queryFn: () => apiData(getBrowserApi().platform.cluster.get()),
		refetchInterval: 15_000,
		refetchOnWindowFocus: true
	});
}

export function useClusterEvents() {
	return useQuery({
		queryKey: queryKeys.clusterEvents,
		queryFn: () => apiData(getBrowserApi().platform.cluster.events.get()),
		refetchInterval: 30_000
	});
}

// Keeping the previous range's data while the next loads stops the chart from flashing back to the live buffer.
export function useClusterUsage(range: MetricsRange) {
	return useQuery({
		queryKey: queryKeys.clusterUsage(range),
		queryFn: () => apiData(getBrowserApi().platform.cluster.usage.get({ range })),
		refetchInterval: pollIntervalForRange(range),
		placeholderData: keepPreviousData
	});
}

export function useClusterNode(name: string) {
	return useQuery({
		queryKey: queryKeys.clusterNode(name),
		queryFn: () => apiData(getBrowserApi().platform.cluster.nodes(name).get()),
		refetchInterval: 15_000
	});
}

export function useClusterNodeUsage(name: string, range: MetricsRange) {
	return useQuery({
		queryKey: queryKeys.clusterNodeUsage(name, range),
		queryFn: () => apiData(getBrowserApi().platform.cluster.nodes(name).usage.get({ range })),
		refetchInterval: pollIntervalForRange(range),
		placeholderData: keepPreviousData
	});
}

// Call it above the tab switcher: the buffer is the only copy of this history, so unmounting the chart must not discard it.
export function useClusterLiveSeries(snapshot: ClusterSnapshot | undefined) {
	const [series, setSeries] = useState(emptyLiveSeries);
	useEffect(() => setSeries(previous => appendLiveSample(previous, snapshot)), [snapshot]);
	return series;
}
