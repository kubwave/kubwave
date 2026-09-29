'use client';

import { apiData } from '@kubwave/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { serviceErrorMessage } from '@/lib/api/api-error';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import type { Service } from '@/lib/api/types';
import { buildServiceUpdate, settingsErrors, snapshotService, type ServiceSettingsValues, type SettingsErrors } from '@/lib/service-settings';
import { applyDrafts, stagedEntries, withDraft, withoutSettled, type ApplyMode, type Drafts, type StagedEntry } from './staged-drafts';

type StagedChanges = {
	drafts: Drafts;
	entries: StagedEntry[];
	// Validation errors per service from the last apply attempt; shown in its settings.
	errors: Record<string, SettingsErrors>;
	applying: boolean;
	stage: (serviceId: string, baseline: ServiceSettingsValues, values: ServiceSettingsValues) => void;
	discard: () => void;
	apply: (services: Service[], mode: ApplyMode) => Promise<void>;
};

const StagedChangesContext = createContext<StagedChanges | null>(null);

// Settings and variable edits of every service in one environment, applied together: each changed
// service is saved (PATCH) and, for "deploy", redeployed.
export function StagedChangesProvider({ environmentId, children }: { environmentId: string; children: React.ReactNode }) {
	const queryClient = useQueryClient();
	const [drafts, setDrafts] = useState<Drafts>({});
	const [errors, setErrors] = useState<Record<string, SettingsErrors>>({});
	const [applying, setApplying] = useState(false);

	const stage = useCallback((serviceId: string, baseline: ServiceSettingsValues, values: ServiceSettingsValues) => {
		setDrafts(current => withDraft(current, serviceId, baseline, values));
	}, []);

	const discard = useCallback(() => {
		setDrafts({});
		setErrors({});
	}, []);

	const apply = useCallback(
		async (services: Service[], mode: ApplyMode) => {
			setApplying(true);
			try {
				const outcome = await applyDrafts(drafts, services, mode, {
					save: (service, values) => apiData(getBrowserApi().services(service.id).patch(buildServiceUpdate(service, values))),
					deploy: serviceId => apiData(getBrowserApi().services(serviceId).deployments.post())
				});
				// Wait for the saved values before dropping the drafts, so the panel doesn't flash the old ones.
				await queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(environmentId) });
				void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServiceStatus(environmentId) });
				for (const id of outcome.settled) void queryClient.invalidateQueries({ queryKey: queryKeys.serviceDeployments(id) });
				setDrafts(current => withoutSettled(current, drafts, outcome.settled));
				setErrors(outcome.invalid);

				const nameOf = (id: string) => services.find(service => service.id === id)?.name ?? 'Service';
				const saved = outcome.settled.filter(id => services.some(service => service.id === id));
				const deployFailed = new Set(outcome.failed.filter(failure => failure.step === 'deploy').map(failure => failure.serviceId));
				const succeeded = mode === 'deploy' ? saved.filter(id => !deployFailed.has(id)) : saved;
				if (succeeded.length > 0)
					toast.success(mode === 'deploy' ? 'Deploying changes' : 'Changes saved', { description: succeeded.map(nameOf).join(', ') });
				for (const { serviceId, step, error } of outcome.failed) {
					if (step === 'save') toast.error(`${nameOf(serviceId)}: ${serviceErrorMessage(error)}`);
					else
						toast.error(`${nameOf(serviceId)}: saved, but the deployment could not start.`, {
							description: serviceErrorMessage(error, '') || undefined
						});
				}
				const invalid = Object.keys(outcome.invalid);
				if (invalid.length > 0)
					toast.error('Some changes need fixing', { description: `Check the highlighted fields in ${invalid.map(nameOf).join(', ')}.` });
			} finally {
				setApplying(false);
			}
		},
		[drafts, environmentId, queryClient]
	);

	const value = useMemo(
		() => ({ drafts, entries: stagedEntries(drafts), errors, applying, stage, discard, apply }),
		[drafts, errors, applying, stage, discard, apply]
	);
	return <StagedChangesContext value={value}>{children}</StagedChangesContext>;
}

export function useStagedChanges(): StagedChanges {
	const staged = useContext(StagedChangesContext);
	if (!staged) throw new Error('useStagedChanges must be used inside <StagedChangesProvider>');
	return staged;
}

// The settings of one service as currently edited: its staged draft, or a fresh snapshot.
export function useServiceDraft(service: Service) {
	const { drafts, errors, stage } = useStagedChanges();
	const snapshot = useMemo(() => snapshotService(service), [service]);
	const draft = drafts[service.id];
	const baseline = draft?.baseline ?? snapshot;
	const values = draft?.values ?? snapshot;
	const update = useCallback(
		(change: (values: ServiceSettingsValues) => ServiceSettingsValues) => stage(service.id, baseline, change(values)),
		[stage, service.id, baseline, values]
	);
	// Errors appear after a failed apply, then track the edits live so fixed fields clear at once.
	const failed = errors[service.id] !== undefined;
	const liveErrors = useMemo(() => (failed ? settingsErrors(service, values) : {}), [failed, service, values]);
	return { values, update, errors: liveErrors };
}
