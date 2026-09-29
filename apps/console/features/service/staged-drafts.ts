import type { Service } from '@/lib/api/types';
import { changedGroups, settingsErrors, type ServiceSettingsValues, type SettingsErrors, type SettingsGroup } from '@/lib/service-settings';

// Unsaved edits per service, kept on the canvas until they are saved, deployed or discarded.
export type Draft = { baseline: ServiceSettingsValues; values: ServiceSettingsValues };
export type Drafts = Record<string, Draft>;
export type StagedEntry = { serviceId: string; groups: SettingsGroup[] };

export function withDraft(drafts: Drafts, serviceId: string, baseline: ServiceSettingsValues, values: ServiceSettingsValues): Drafts {
	const { [serviceId]: _previous, ...others } = drafts;
	return changedGroups(baseline, values).length > 0 ? { ...others, [serviceId]: { baseline, values } } : others;
}

export type ApplyMode = 'save' | 'deploy';

export type ApplyOutcome = {
	// Drafts that are done: saved, or belonging to a service that no longer exists.
	settled: string[];
	invalid: Record<string, SettingsErrors>;
	failed: Array<{ serviceId: string; step: 'save' | 'deploy'; error: unknown }>;
};

// Saves each staged service in turn and, for "deploy", redeploys it. A save that worked settles
// its draft even when the deploy after it fails, so the saved edit is not offered again.
export async function applyDrafts(
	drafts: Drafts,
	services: Service[],
	mode: ApplyMode,
	api: { save: (service: Service, values: ServiceSettingsValues) => Promise<unknown>; deploy: (serviceId: string) => Promise<unknown> }
): Promise<ApplyOutcome> {
	const outcome: ApplyOutcome = { settled: [], invalid: {}, failed: [] };
	for (const [serviceId, draft] of Object.entries(drafts)) {
		const service = services.find(candidate => candidate.id === serviceId);
		if (!service) {
			outcome.settled.push(serviceId);
			continue;
		}
		const errors = settingsErrors(service, draft.values);
		if (Object.keys(errors).length > 0) {
			outcome.invalid[serviceId] = errors;
			continue;
		}
		try {
			await api.save(service, draft.values);
		} catch (error) {
			outcome.failed.push({ serviceId, step: 'save', error });
			continue;
		}
		outcome.settled.push(serviceId);
		if (mode === 'save') continue;
		try {
			await api.deploy(serviceId);
		} catch (error) {
			outcome.failed.push({ serviceId, step: 'deploy', error });
		}
	}
	return outcome;
}

// Drops settled drafts, except ones edited again while the apply ran (a new draft object).
export function withoutSettled(current: Drafts, applied: Drafts, settled: string[]): Drafts {
	return Object.fromEntries(Object.entries(current).filter(([id, draft]) => !(settled.includes(id) && draft === applied[id])));
}

export function stagedEntries(drafts: Drafts): StagedEntry[] {
	return Object.entries(drafts).map(([serviceId, draft]) => ({ serviceId, groups: changedGroups(draft.baseline, draft.values) }));
}
