export const HA_SETTINGS_KEY = 'ha';

export interface HaSettings {
	enabled: boolean;
}

export const DEFAULT_HA_SETTINGS: HaSettings = { enabled: false };

export function resolveHaSettings(value: unknown): HaSettings {
	const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<HaSettings>) : {};
	return { enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_HA_SETTINGS.enabled };
}
