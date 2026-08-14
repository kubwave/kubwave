import { describe, expect, mock, test } from 'bun:test';

const DIGEST = 'sha256:357ec2ceadfc097b09cd1cace7b0645e111b30bf7ac7fc79adf20af2a496a029';
const persisted: Array<{ deploymentId: string; imageRef: string }> = [];
let digestResult: string | null = DIGEST;
let digestThrows = false;

mock.module('~/modules/worker/jobs/registry-tag-watch/registry', () => ({
	parseImageRef: (image: string, tag: string) => ({ host: 'registry-1.docker.io', repo: image, tag }),
	resolveTagDigest: async () => {
		if (digestThrows) throw new Error('registry unreachable');
		return digestResult;
	}
}));

mock.module('@kubwave/db', () => ({
	db: {
		update: () => ({ set: (v: { imageRef: string }) => ({ where: async () => persisted.push({ deploymentId: 'captured', imageRef: v.imageRef }) }) })
	},
	deployments: {}
}));

const { resolveDeploymentImageRef } = await import('~/modules/worker/jobs/deployments/image-ref');

function args(overrides: Record<string, unknown> = {}) {
	return { deploymentId: 'dep-1', image: 'postgres', tag: '16', label: 'postgres', ...overrides };
}

describe('resolveDeploymentImageRef', () => {
	test('pins the resolved digest and records it', async () => {
		persisted.length = 0;
		const result = await resolveDeploymentImageRef(args());
		expect(result).toEqual({ ref: `postgres@${DIGEST}`, pinned: true });
		expect(persisted).toEqual([{ deploymentId: 'captured', imageRef: `postgres@${DIGEST}` }]);
	});

	test('reuses a recorded ref without touching the registry', async () => {
		persisted.length = 0;
		const result = await resolveDeploymentImageRef(args({ recordedRef: `postgres@${DIGEST}` }));
		expect(result).toEqual({ ref: `postgres@${DIGEST}`, pinned: true });
		expect(persisted).toEqual([]);
	});

	test('reports a recorded tag ref as unpinned', async () => {
		const result = await resolveDeploymentImageRef(args({ recordedRef: 'postgres:16' }));
		expect(result).toEqual({ ref: 'postgres:16', pinned: false });
	});

	// reconcileInFlight walks its rows sequentially, so retrying every tick would stall every other in-flight deployment.
	test('records the tag fallback too, so a failure is resolved exactly once per deployment', async () => {
		digestThrows = true;
		persisted.length = 0;
		try {
			const result = await resolveDeploymentImageRef(args());
			expect(result).toEqual({ ref: 'postgres:16', pinned: false });
		} finally {
			digestThrows = false;
		}
		expect(persisted).toEqual([{ deploymentId: 'captured', imageRef: 'postgres:16' }]);
	});

	// A 404 returns null rather than throwing, so without its own branch this fallback would be entirely silent.
	test('warns on a missing tag as well as on an unreachable registry', async () => {
		const warnings: string[] = [];
		const original = console.warn;
		console.warn = (...parts: unknown[]) => void warnings.push(parts.join(' '));
		digestResult = null;
		try {
			const result = await resolveDeploymentImageRef(args());
			expect(result).toEqual({ ref: 'postgres:16', pinned: false });
		} finally {
			digestResult = DIGEST;
			console.warn = original;
		}
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('tag not found');
	});
});
