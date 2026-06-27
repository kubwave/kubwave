import type { OpenPr } from './providers.js';

export interface ExistingPreview {
	id: string;
	prNumber: number;
}

export interface PreviewDiff<E extends ExistingPreview> {
	toCreate: OpenPr[];
	toTeardown: E[];
}

// Diff open PRs (for ONE repo) against existing previews: new PR -> create, preview whose PR is no
// longer open -> tear down. IMPORTANT: `open` must come from a SUCCESSFUL poll - a failed poll
// reaching here would tear down live previews (spec section8).
export function diffPreviews<E extends ExistingPreview>(open: OpenPr[], existing: E[]): PreviewDiff<E> {
	const openByNumber = new Set(open.map(p => p.prNumber));
	const existingByNumber = new Set(existing.map(e => e.prNumber));
	return {
		toCreate: open.filter(p => !existingByNumber.has(p.prNumber)),
		toTeardown: existing.filter(e => !openByNumber.has(e.prNumber))
	};
}
