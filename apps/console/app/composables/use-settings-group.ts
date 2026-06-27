import type { Ref } from 'vue';

// Seed the draft from the server once on first arrival so refetches never clobber unsaved edits; dirty-check against the server, write only when dirty.

// Structural equality over the plain (primitive + nested-object) draft shapes used by settings groups.
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
	const aKeys = Object.keys(a as object);
	const bKeys = Object.keys(b as object);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

interface SaveLike<TPayload> {
	mutateAsync: (payload: TPayload) => Promise<unknown>;
	isPending: Ref<boolean>;
}

export interface SettingsGroupOptions<TSource, TDraft, TPayload> {
	source: Ref<TSource | undefined>;
	save: SaveLike<TPayload>;
	// Draft values rendered before the source first arrives (the settings queries load client-side).
	initial: TDraft;
	// Map server settings to the editable draft shape. Defaults to a structural clone.
	toDraft: (source: TSource) => TDraft;
	// Map the draft to the mutation payload. Defaults to the draft itself.
	toPayload?: (draft: TDraft) => TPayload;
	// Defaults to comparing draft vs server-derived draft; override when the payload has fields the server never echoes back (e.g. a typed password).
	isDirty?: (draft: TDraft, source: TSource) => boolean;
	validate?: (draft: TDraft) => boolean;
	// Runs on the draft after a successful save (e.g. clear a typed password so the group settles).
	afterSave?: (draft: TDraft) => void;
}

export interface SettingsGroup<TDraft> {
	draft: TDraft;
	isDirty: ComputedRef<boolean>;
	isValid: ComputedRef<boolean>;
	isSaving: ComputedRef<boolean>;
	seed: () => void;
	discard: () => void;
	save: () => Promise<void>;
}

export function useSettingsGroup<TSource, TDraft extends object, TPayload = TDraft>(
	options: SettingsGroupOptions<TSource, TDraft, TPayload>
): SettingsGroup<TDraft> {
	const { source, save: saver, toDraft } = options;
	const toPayload = options.toPayload ?? ((draft: TDraft) => draft as unknown as TPayload);

	// Start from the supplied defaults; seed() fills the draft in place once the source first arrives.
	const draft = reactive({ ...options.initial }) as TDraft;

	function seed() {
		const value = source.value;
		if (!value) return;
		Object.assign(draft, toDraft(value));
	}

	// Seed once on first arrival, then leave the draft alone so refetches can't stomp edits.
	let seeded = false;
	watch(
		source,
		value => {
			if (value && !seeded) {
				seed();
				seeded = true;
			}
		},
		{ immediate: true }
	);

	const isDirty = computed(() => {
		const value = source.value;
		if (!value) return false;
		if (options.isDirty) return options.isDirty(draft, value);
		return !deepEqual(draft, toDraft(value));
	});

	const isValid = computed(() => (options.validate ? options.validate(draft) : true));
	const isSaving = computed(() => saver.isPending.value);

	async function save() {
		if (!isDirty.value || !isValid.value) return;
		await saver.mutateAsync(toPayload(draft));
		options.afterSave?.(draft);
	}

	function discard() {
		seed();
	}

	return { draft, isDirty, isValid, isSaving, seed, discard, save };
}

// Compose N groups behind one save surface; save runs only the dirty groups under allSettled, so a partial failure leaves only the failed group dirty.
export function composeSettingsGroups(groups: SettingsGroup<unknown>[]) {
	const isDirty = computed(() => groups.some(group => group.isDirty.value));
	const isValid = computed(() => groups.every(group => group.isValid.value));
	const isSaving = computed(() => groups.some(group => group.isSaving.value));
	const dirtyCount = computed(() => groups.filter(group => group.isDirty.value).length);
	const canSave = computed(() => isDirty.value && isValid.value && !isSaving.value);

	async function save() {
		if (!isDirty.value || !isValid.value) return;
		await Promise.allSettled(groups.filter(group => group.isDirty.value).map(group => group.save()));
	}

	function discard() {
		for (const group of groups) group.discard();
	}

	return { isDirty, isValid, isSaving, dirtyCount, canSave, save, discard };
}
