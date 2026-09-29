'use client';

import {
	apiData,
	type PlatformSettingsAiUpdateData,
	type PlatformSettingsDeploymentConcurrencyUpdateData,
	type PlatformSettingsDomainUpdateData,
	type PlatformSettingsHaUpdateData,
	type PlatformSettingsMetricsUpdateData,
	type PlatformSettingsPrPreviewsUpdateData,
	type PlatformSettingsSmtpUpdateData,
	type PlatformSettingsTcpPortPoolUpdateData,
	type PlatformSettingsVolumeAutoscalingUpdateData
} from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRegistrySettings } from '@/features/platform/use-registry-settings';
import type { RegistryPayload } from '@/features/platform/registry-model';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';

const settingsApi = () => getBrowserApi().platform.settings;

type SettingOptions<TData, TPayload> = {
	queryKey: QueryKey;
	get: () => Promise<TData>;
	put: (payload: TPayload) => Promise<TData>;
	saved: (data: TData) => [title: string, description?: string];
	errorHint?: string;
	invalidates?: QueryKey[];
};

// One platform setting: its query plus a save that writes the response back into the cache and toasts.
function useSetting<TData, TPayload>({
	queryKey,
	get,
	put,
	saved,
	errorHint = 'Check the values and try again.',
	invalidates = []
}: SettingOptions<TData, TPayload>) {
	const queryClient = useQueryClient();
	const query = useQuery({ queryKey, queryFn: get });
	const mutation = useMutation({
		mutationFn: put,
		onSuccess: data => {
			queryClient.setQueryData(queryKey, data);
			for (const key of invalidates) void queryClient.invalidateQueries({ queryKey: key });
			const [title, description] = saved(data);
			toast.success(title, { description });
		},
		onError: () => toast.error('Could not save settings', { description: errorHint })
	});
	return { query, save: mutation.mutateAsync };
}

export const useHaSetting = () =>
	useSetting({
		queryKey: queryKeys.haSettings,
		get: () => apiData(settingsApi().ha.get()),
		put: (payload: PlatformSettingsHaUpdateData['body']) => apiData(settingsApi().ha.put(payload)),
		saved: s => [
			s.enabled ? 'High availability enabled' : 'High availability disabled',
			'The worker is rolling the control plane to match — this takes a moment.'
		],
		errorHint: 'Try again in a moment.'
	});

export const useConcurrencySetting = () =>
	useSetting({
		queryKey: queryKeys.deploymentConcurrency,
		get: () => apiData(settingsApi().deploymentConcurrency.get()),
		put: (payload: PlatformSettingsDeploymentConcurrencyUpdateData['body']) => apiData(settingsApi().deploymentConcurrency.put(payload)),
		saved: s => ['Deployment concurrency saved', `Up to ${s.maxConcurrentDeployments} deployment(s) will run at the same time.`],
		errorHint: 'Try again in a moment.'
	});

export const usePrPreviewSetting = () =>
	useSetting({
		queryKey: queryKeys.prPreviews,
		get: () => apiData(settingsApi().prPreviews.get()),
		put: (payload: PlatformSettingsPrPreviewsUpdateData['body']) => apiData(settingsApi().prPreviews.put(payload)),
		saved: s => [
			'PR preview limit saved',
			s.maxPreviewsPerProject === 0
				? 'Preview environment creation is paused.'
				: `Up to ${s.maxPreviewsPerProject} preview environment(s) per project.`
		],
		errorHint: 'Try again in a moment.'
	});

export const useAutoscalingSetting = () =>
	useSetting({
		queryKey: queryKeys.volumeAutoscalingSettings,
		get: () => apiData(settingsApi().volumeAutoscaling.get()),
		put: (payload: PlatformSettingsVolumeAutoscalingUpdateData['body']) => apiData(settingsApi().volumeAutoscaling.put(payload)),
		saved: s => [
			s.enabled ? 'Volume autoscaling enabled' : 'Volume autoscaling disabled',
			'The worker checks platform volume usage every few minutes.'
		]
	});

export const useDomainSetting = () =>
	useSetting({
		queryKey: queryKeys.defaultDomain,
		get: () => apiData(settingsApi().domain.get()),
		put: (payload: PlatformSettingsDomainUpdateData['body']) => apiData(settingsApi().domain.put(payload)),
		saved: () => ['Domain settings saved'],
		invalidates: [queryKeys.services, queryKeys.environments]
	});

export const useSmtpSetting = () =>
	useSetting({
		queryKey: queryKeys.smtp,
		get: () => apiData(settingsApi().smtp.get()),
		put: (payload: PlatformSettingsSmtpUpdateData['body']) => apiData(settingsApi().smtp.put(payload)),
		saved: () => ['SMTP settings saved']
	});

export const useMetricsSetting = () =>
	useSetting({
		queryKey: queryKeys.metricsSettings,
		get: () => apiData(settingsApi().metrics.get()),
		put: (payload: PlatformSettingsMetricsUpdateData['body']) => apiData(settingsApi().metrics.put(payload)),
		saved: () => ['Metrics settings saved']
	});

export const useAiSetting = () =>
	useSetting({
		queryKey: queryKeys.aiSettings,
		get: () => apiData(settingsApi().ai.get()),
		put: (payload: PlatformSettingsAiUpdateData['body']) => apiData(settingsApi().ai.put(payload)),
		saved: () => ['AI settings saved'],
		invalidates: [queryKeys.aiStatus]
	});

export function useRegistrySetting() {
	const { settings, save } = useRegistrySettings();
	return {
		query: settings,
		save: (payload: RegistryPayload) =>
			save.mutateAsync(payload, {
				onSuccess: () => toast.success('Registry settings saved'),
				onError: () => toast.error('Could not save registry settings', { description: 'Check the values and try again.' })
			})
	};
}

// Live fill of the platform-managed PVCs; slow polling since they grow over hours, not seconds.
export function usePlatformVolumes() {
	return useQuery({
		queryKey: queryKeys.platformVolumes,
		queryFn: () => apiData(settingsApi().platformVolumes.get()),
		refetchInterval: 30_000,
		refetchOnWindowFocus: true
	});
}

export function useSendTestEmail() {
	return useMutation({
		mutationFn: (to: string) => apiData(settingsApi().smtp.test.post({ to })),
		onSuccess: (result, to) => {
			if (result.ok) toast.success('Test email sent', { description: `Check the inbox for ${to}.` });
			else toast.error('Test email failed', { description: result.error ?? 'SMTP error' });
		},
		onError: () => toast.error('Test email failed', { description: 'SMTP error' })
	});
}

// Saving the pool starts an update run (Traefik, load balancer, API and worker reconcile), returned for progress.
export function useTcpPoolSetting() {
	const queryClient = useQueryClient();
	const query = useQuery({ queryKey: queryKeys.tcpPortPoolSettings, queryFn: () => apiData(settingsApi().tcpPortPool.get()) });
	const mutation = useMutation({
		mutationFn: (payload: PlatformSettingsTcpPortPoolUpdateData['body']) => apiData(settingsApi().tcpPortPool.put(payload)),
		onSuccess: ({ enabled, start, size }) => {
			queryClient.setQueryData(queryKeys.tcpPortPoolSettings, { enabled, start, size });
			void queryClient.invalidateQueries({ queryKey: queryKeys.updates });
			toast.success('TCP port pool update started', { description: 'Traefik, the load balancer, API, and worker are reconciling now.' });
		},
		onError: () => toast.error('Could not update TCP port pool', { description: 'Remove exposures outside the selected pool, then try again.' })
	});
	return { query, save: mutation.mutateAsync, saving: mutation.isPending };
}
