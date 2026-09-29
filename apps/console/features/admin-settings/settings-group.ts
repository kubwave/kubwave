export type FieldErrors<TDraft> = Partial<Record<keyof TDraft, string>>;

// One independently saved settings resource: how the server value maps to an editable draft and back.
export type GroupSpec<TSource, TDraft, TPayload> = {
	initial: TDraft;
	toDraft: (source: TSource) => TDraft;
	toPayload: (draft: TDraft) => TPayload;
	errors?: (draft: TDraft, source: TSource) => FieldErrors<TDraft>;
};

export type SaveableGroup = { dirty: boolean; valid: boolean; save: () => Promise<void> };

// Compares what would be sent (both sides built by the same toPayload, so key order matches): trimmed-away
// whitespace is no change, a typed write-only secret is.
export function isGroupDirty<TSource, TDraft, TPayload>(
	spec: GroupSpec<TSource, TDraft, TPayload>,
	draft: TDraft,
	source: TSource | undefined
): boolean {
	if (source === undefined) return false;
	return JSON.stringify(spec.toPayload(draft)) !== JSON.stringify(spec.toPayload(spec.toDraft(source)));
}

export function hasErrors(errors: Partial<Record<string, string>>): boolean {
	return Object.values(errors).some(Boolean);
}

export function saveBarState(groups: readonly SaveableGroup[]): { changes: number; blocked: boolean } {
	const dirty = groups.filter(group => group.dirty);
	return { changes: dirty.length, blocked: dirty.some(group => !group.valid) };
}

// allSettled: a failing group stays dirty while the others save.
export function saveDirtyGroups(groups: readonly SaveableGroup[]): Promise<PromiseSettledResult<void>[]> {
	return Promise.allSettled(groups.filter(group => group.dirty).map(group => group.save()));
}
