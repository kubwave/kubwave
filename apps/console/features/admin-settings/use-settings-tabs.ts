'use client';

import { aiGroup, autoscalingGroup, concurrencyGroup, domainGroup, haGroup, metricsGroup, prPreviewGroup, registryGroup, smtpGroup } from './model';
import {
	useAiSetting,
	useAutoscalingSetting,
	useConcurrencySetting,
	useDomainSetting,
	useHaSetting,
	useMetricsSetting,
	usePlatformVolumes,
	usePrPreviewSetting,
	useRegistrySetting,
	useSmtpSetting
} from './use-platform-settings';
import { useSettingsGroup } from './use-settings-group';

export function useScalingGroups() {
	const ha = useHaSetting();
	const concurrency = useConcurrencySetting();
	const prPreview = usePrPreviewSetting();
	const autoscaling = useAutoscalingSetting();
	const registry = useRegistrySetting();
	const volumes = usePlatformVolumes();
	const showRegistryStorage = registry.query.data?.mode === 'platform';
	return {
		ha: useSettingsGroup(haGroup, ha.query, ha.save),
		concurrency: useSettingsGroup(concurrencyGroup, concurrency.query, concurrency.save),
		prPreview: useSettingsGroup(prPreviewGroup, prPreview.query, prPreview.save),
		autoscaling: useSettingsGroup(autoscalingGroup(showRegistryStorage), autoscaling.query, autoscaling.save),
		showRegistryStorage,
		volumes
	};
}

export function useIntegrationGroups() {
	const domain = useDomainSetting();
	const registry = useRegistrySetting();
	const smtp = useSmtpSetting();
	const metrics = useMetricsSetting();
	const ai = useAiSetting();
	return {
		domain: useSettingsGroup(domainGroup, domain.query, domain.save),
		registry: useSettingsGroup(registryGroup, registry.query, registry.save),
		smtp: useSettingsGroup(smtpGroup, smtp.query, smtp.save),
		metrics: useSettingsGroup(metricsGroup, metrics.query, metrics.save),
		ai: useSettingsGroup(aiGroup, ai.query, ai.save)
	};
}

export type ScalingGroups = ReturnType<typeof useScalingGroups>;
export type IntegrationGroups = ReturnType<typeof useIntegrationGroups>;
