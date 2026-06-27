// Admin setting for platform volume auto-expansion (CNPG postgres + registry + managed Prometheus); shared by API and worker.
export const VOLUME_AUTOSCALING_SETTINGS_KEY = 'volume-autoscaling';

export interface VolumeAutoscalingSettings {
	enabled: boolean;
	// Grow a volume once kubelet-reported usage exceeds this percentage of its capacity.
	thresholdPercent: number;
	// Each expansion grows the declared size by this percentage, rounded up to whole Gi.
	growthPercent: number;
	// Hard per-volume ceilings (whole-Gi); at the cap the worker stops growing and emits a Warning Event. Volumes only ever grow, never shrink.
	caps: { postgres: string; registry: string; prometheus: string };
}

// Disabled by default. Auto-expansion grows cloud volumes and the bill; admin opts in.
export const DEFAULT_VOLUME_AUTOSCALING: VolumeAutoscalingSettings = {
	enabled: false,
	thresholdPercent: 80,
	growthPercent: 50,
	caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
};

// Merge stored settings over defaults so partially-written rows still resolve.
export function resolveVolumeAutoscaling(value: unknown): VolumeAutoscalingSettings {
	const v = (value ?? {}) as Partial<VolumeAutoscalingSettings> & { caps?: Partial<VolumeAutoscalingSettings['caps']> };
	return {
		enabled: v.enabled ?? DEFAULT_VOLUME_AUTOSCALING.enabled,
		thresholdPercent: v.thresholdPercent ?? DEFAULT_VOLUME_AUTOSCALING.thresholdPercent,
		growthPercent: v.growthPercent ?? DEFAULT_VOLUME_AUTOSCALING.growthPercent,
		caps: {
			postgres: v.caps?.postgres ?? DEFAULT_VOLUME_AUTOSCALING.caps.postgres,
			registry: v.caps?.registry ?? DEFAULT_VOLUME_AUTOSCALING.caps.registry,
			prometheus: v.caps?.prometheus ?? DEFAULT_VOLUME_AUTOSCALING.caps.prometheus
		}
	};
}
