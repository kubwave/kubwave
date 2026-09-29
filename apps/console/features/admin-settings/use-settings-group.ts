'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { hasErrors, isGroupDirty, saveBarState, saveDirtyGroups, type FieldErrors, type GroupSpec, type SaveableGroup } from './settings-group';

export type SettingsGroup<TSource, TDraft> = SaveableGroup & {
	source: TSource | undefined;
	draft: TDraft;
	errors: FieldErrors<TDraft>;
	// Loaded means real server values: a failed load must not show the placeholder draft as if it were saved.
	loaded: boolean;
	failed: boolean;
	retry: () => void;
	set: (patch: Partial<TDraft>) => void;
	discard: () => void;
};

// Untouched drafts follow the server; the first edit freezes them locally so refetches never clobber it.
// A successful save or a discard hands the draft back to the server value, unless it was edited
// again while the save ran.
export function useSettingsGroup<TSource, TDraft, TPayload>(
	spec: GroupSpec<TSource, TDraft, TPayload>,
	query: { data: TSource | undefined; isError: boolean; refetch: () => unknown },
	save: (payload: TPayload) => Promise<unknown>
): SettingsGroup<TSource, TDraft> {
	const [edited, setEdited] = useState<TDraft | null>(null);
	const source = query.data;
	const base = source === undefined ? spec.initial : spec.toDraft(source);
	const draft = edited ?? base;
	const errors: FieldErrors<TDraft> = source === undefined ? {} : (spec.errors?.(draft, source) ?? {});
	return {
		source,
		draft,
		errors,
		loaded: source !== undefined,
		failed: source === undefined && query.isError,
		retry: () => void query.refetch(),
		dirty: isGroupDirty(spec, draft, source),
		valid: !hasErrors(errors),
		set: patch => setEdited(current => ({ ...(current ?? base), ...patch })),
		discard: () => setEdited(null),
		save: async () => {
			const sent = edited;
			await save(spec.toPayload(draft));
			setEdited(current => (current === sent ? null : current));
		}
	};
}

export function useSaveBar(groups: readonly (SaveableGroup & { discard: () => void })[]) {
	const [pending, setPending] = useState(false);
	const { changes, blocked } = saveBarState(groups);
	return {
		changes,
		pending,
		onDiscard: () => groups.forEach(group => group.discard()),
		onSave: async () => {
			if (blocked) {
				toast.error('Fix the highlighted fields before saving');
				return;
			}
			setPending(true);
			await saveDirtyGroups(groups);
			setPending(false);
		}
	};
}
