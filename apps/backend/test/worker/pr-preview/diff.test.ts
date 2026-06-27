import { describe, expect, it } from 'bun:test';
import { diffPreviews } from '~/modules/worker/jobs/pr-preview/diff';
import type { OpenPr } from '~/modules/worker/jobs/pr-preview/providers';

const pr = (n: number): OpenPr => ({ prNumber: n, prRef: `refs/pull/${n}/head`, headSha: String(n).repeat(40).slice(0, 40) });

describe('diffPreviews', () => {
	it('flags new PRs to create and gone previews to tear down', () => {
		const open = [pr(1), pr(2)];
		const existing = [
			{ id: 'env-2', prNumber: 2 },
			{ id: 'env-9', prNumber: 9 }
		];
		const { toCreate, toTeardown } = diffPreviews(open, existing);
		expect(toCreate.map(p => p.prNumber)).toEqual([1]);
		expect(toTeardown.map(e => e.id)).toEqual(['env-9']);
	});
	it('creates nothing and tears down nothing when in sync', () => {
		const { toCreate, toTeardown } = diffPreviews([pr(5)], [{ id: 'env-5', prNumber: 5 }]);
		expect(toCreate).toEqual([]);
		expect(toTeardown).toEqual([]);
	});
});
