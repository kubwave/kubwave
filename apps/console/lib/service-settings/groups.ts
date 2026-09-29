import { rowId, type ServiceSettingsValues } from './values';

export const SETTINGS_GROUPS = ['general', 'source', 'resources', 'networking', 'variables'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

const GROUP_OF: Partial<Record<keyof ServiceSettingsValues, SettingsGroup>> = {
	name: 'general',
	description: 'general',
	resources: 'resources',
	autoscaling: 'resources',
	volumes: 'resources',
	configFiles: 'resources',
	command: 'resources',
	args: 'resources',
	healthCheck: 'networking',
	domains: 'networking',
	defaultDomainEnabled: 'networking',
	containerPort: 'networking',
	exposedPorts: 'networking',
	basicAuth: 'networking',
	env: 'variables',
	secrets: 'variables'
};

// The settings section a field path belongs to (for error badges and navigation).
export function groupForPath(path: string): SettingsGroup {
	return GROUP_OF[path.split('.')[0] as keyof ServiceSettingsValues] ?? 'source';
}

// Row ids are ui-only and do not count as a change.
const comparable = (value: unknown) => JSON.stringify(value, (key, inner) => (key === '_id' ? undefined : inner));

// Sections a draft changed relative to its baseline, in display order.
export function changedGroups(baseline: ServiceSettingsValues, values: ServiceSettingsValues): SettingsGroup[] {
	const changed = new Set<SettingsGroup>();
	for (const key of Object.keys(values) as Array<keyof ServiceSettingsValues>)
		if (comparable(values[key]) !== comparable(baseline[key])) changed.add(groupForPath(key));
	return SETTINGS_GROUPS.filter(group => changed.has(group));
}

// Pasted .env entries land in the chosen list and replace same-named keys in both lists, so a key
// never ends up as both a variable and a secret.
export function importDotenv(
	values: ServiceSettingsValues,
	entries: Array<{ key: string; value: string }>,
	asSecrets: boolean
): ServiceSettingsValues {
	const keys = new Set(entries.map(entry => entry.key));
	const env = values.env.filter(entry => !keys.has(entry.key));
	const secrets = values.secrets.filter(secret => !keys.has(secret.key));
	if (asSecrets)
		return { ...values, env, secrets: [...secrets, ...entries.map(({ key, value }) => ({ _id: rowId(), key, value, hasValue: false }))] };
	return { ...values, secrets, env: [...env, ...entries.map(({ key, value }) => ({ _id: rowId(), key, value }))] };
}
