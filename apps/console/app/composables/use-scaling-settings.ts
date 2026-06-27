import type { InjectionKey } from 'vue';
import { composeSettingsGroups, useSettingsGroup } from '~/composables/use-settings-group';

// Admin "Scaling & storage" tab: four settings groups behind one draft + save bar.
// composeSettingsGroups() writes only dirty groups under allSettled, so a partial failure leaves only the failed group dirty.

interface HaDraft {
	enabled: boolean;
}
interface ConcurrencyDraft {
	maxConcurrentDeployments: number;
}
interface PrPreviewDraft {
	maxPreviewsPerProject: number;
}
interface AutoscalingDraft {
	enabled: boolean;
	thresholdPercent: number;
	growthPercent: number;
	postgresCap: string;
	registryCap: string;
	prometheusCap: string;
}

const GI_PATTERN = /^\d+Gi$/;
function giOk(value: string): boolean {
	return GI_PATTERN.test(value) && Number(value.slice(0, -2)) >= 10;
}

// Single source of truth shared by save-gating validate and the inline percentsValid/capsValid flags, so the two can't drift.
function percentsOk(d: AutoscalingDraft): boolean {
	return (
		Number.isInteger(d.thresholdPercent) &&
		d.thresholdPercent >= 50 &&
		d.thresholdPercent <= 95 &&
		Number.isInteger(d.growthPercent) &&
		d.growthPercent >= 10 &&
		d.growthPercent <= 100
	);
}
function capsOk(d: AutoscalingDraft, requireRegistry: boolean): boolean {
	return giOk(d.postgresCap) && (!requireRegistry || giOk(d.registryCap)) && giOk(d.prometheusCap);
}

function createScalingSettingsStore() {
	const ha = useHaSettings();
	const concurrency = useDeploymentConcurrencySettings();
	const prPreview = usePrPreviewSettings();
	const autoscaling = useVolumeAutoscalingSettings();
	const registry = useRegistrySettings();
	const { volumes, isLoading: volumesLoading } = usePlatformVolumes();

	const showRegistryStorage = computed(() => registry.settings.value?.mode === 'platform');

	const haGroup = useSettingsGroup({
		source: ha.settings,
		save: ha.save,
		initial: { enabled: false } as HaDraft,
		toDraft: (s): HaDraft => ({ enabled: s.enabled }),
		toPayload: draft => ({ enabled: draft.enabled })
	});

	const concurrencyGroup = useSettingsGroup({
		source: concurrency.settings,
		save: concurrency.save,
		initial: { maxConcurrentDeployments: 3 } as ConcurrencyDraft,
		toDraft: (s): ConcurrencyDraft => ({ maxConcurrentDeployments: s.maxConcurrentDeployments }),
		toPayload: draft => ({ maxConcurrentDeployments: draft.maxConcurrentDeployments }),
		validate: draft => Number.isInteger(draft.maxConcurrentDeployments) && draft.maxConcurrentDeployments >= 1 && draft.maxConcurrentDeployments <= 20
	});

	const prPreviewGroup = useSettingsGroup({
		source: prPreview.settings,
		save: prPreview.save,
		initial: { maxPreviewsPerProject: 5 } as PrPreviewDraft,
		toDraft: (s): PrPreviewDraft => ({ maxPreviewsPerProject: s.maxPreviewsPerProject }),
		toPayload: draft => ({ maxPreviewsPerProject: draft.maxPreviewsPerProject }),
		validate: draft => Number.isInteger(draft.maxPreviewsPerProject) && draft.maxPreviewsPerProject >= 0 && draft.maxPreviewsPerProject <= 100
	});

	const autoscalingGroup = useSettingsGroup({
		source: autoscaling.settings,
		save: autoscaling.save,
		initial: {
			enabled: false,
			thresholdPercent: 80,
			growthPercent: 50,
			postgresCap: '100Gi',
			registryCap: '200Gi',
			prometheusCap: '50Gi'
		} as AutoscalingDraft,
		toDraft: (s): AutoscalingDraft => ({
			enabled: s.enabled,
			thresholdPercent: s.thresholdPercent,
			growthPercent: s.growthPercent,
			postgresCap: s.caps.postgres,
			registryCap: s.caps.registry,
			prometheusCap: s.caps.prometheus
		}),
		toPayload: draft => ({
			enabled: draft.enabled,
			thresholdPercent: draft.thresholdPercent,
			growthPercent: draft.growthPercent,
			caps: { postgres: draft.postgresCap, registry: draft.registryCap, prometheus: draft.prometheusCap }
		}),
		validate: draft => percentsOk(draft) && capsOk(draft, showRegistryStorage.value)
	});

	const draft = reactive({
		ha: haGroup.draft,
		concurrency: concurrencyGroup.draft,
		prPreview: prPreviewGroup.draft,
		autoscaling: autoscalingGroup.draft
	});

	// Per-card validity flags the cards render inline (the group-level validate folds these together for save gating).
	const concurrencyValid = computed(() => concurrencyGroup.isValid.value);
	const prValid = computed(() => prPreviewGroup.isValid.value);
	const percentsValid = computed(() => percentsOk(draft.autoscaling));
	const capsValid = computed(() => capsOk(draft.autoscaling, showRegistryStorage.value));

	const composed = composeSettingsGroups([haGroup, concurrencyGroup, prPreviewGroup, autoscalingGroup]);

	return reactive({
		draft,
		volumes,
		volumesLoading,
		showRegistryStorage,
		isDirty: composed.isDirty,
		dirtyCount: composed.dirtyCount,
		isSaving: composed.isSaving,
		canSave: composed.canSave,
		concurrencyValid,
		prValid,
		percentsValid,
		capsValid,
		save: composed.save,
		discard: composed.discard
	});
}

export type ScalingSettingsStore = ReturnType<typeof createScalingSettingsStore>;

const SCALING_SETTINGS_KEY: InjectionKey<ScalingSettingsStore> = Symbol('scaling-settings');

/** Create the store and provide it to descendants. Call once, in the container. */
export function provideScalingSettings(): ScalingSettingsStore {
	const store = createScalingSettingsStore();
	provide(SCALING_SETTINGS_KEY, store);
	return store;
}

export function useScalingSettings(): ScalingSettingsStore {
	const store = inject(SCALING_SETTINGS_KEY);
	if (!store) throw new Error('useScalingSettings() must be used within <AdminScalingStorageSettings>');
	return store;
}
