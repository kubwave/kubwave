import { describe, expect, mock, test } from 'bun:test';

const DIGEST = 'sha256:357ec2ceadfc097b09cd1cace7b0645e111b30bf7ac7fc79adf20af2a496a029';
const persisted: Array<{ deploymentId: string; imageRef: string }> = [];
let digestResult: string | null = DIGEST;
let digestThrows = false;
const registryCalls: Array<{ ref: { repo: string; tag: string }; registryAuth: unknown }> = [];

mock.module('~/modules/worker/jobs/registry-tag-watch/registry', () => ({
	parseImageRef: (image: string, tag: string) => ({ host: 'registry-1.docker.io', repo: image, tag }),
	resolveTagDigest: async (ref: { repo: string; tag: string }, registryAuth: unknown) => {
		registryCalls.push({ ref, registryAuth });
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

	// Recording the fallback would make a momentary outage permanent: the deployment would keep the moving tag for its
	// whole life. Retrying costs a HEAD per tick, but only until the rollout goes terminal.
	test('does not record a tag fallback, so a later tick can still pin it', async () => {
		digestThrows = true;
		persisted.length = 0;
		try {
			const result = await resolveDeploymentImageRef(args());
			expect(result).toEqual({ ref: 'postgres:16', pinned: false });
		} finally {
			digestThrows = false;
		}
		expect(persisted).toEqual([]);
	});

	// The credentials are the whole point for a private registry, and the deployer tests only cover the hop into here.
	test('forwards per-service registry credentials to the registry call', async () => {
		registryCalls.length = 0;
		const registryAuth = { server: 'ghcr.io', username: 'u', password: 'v1:cipher' };
		await resolveDeploymentImageRef(args({ image: 'ghcr.io/acme/web', tag: 'next', registryAuth }));
		expect(registryCalls).toHaveLength(1);
		expect(registryCalls[0]!.registryAuth).toBe(registryAuth);
		expect(registryCalls[0]!.ref).toMatchObject({ repo: 'ghcr.io/acme/web', tag: 'next' });
	});

	test('resolves anonymously when a service configures no credentials', async () => {
		registryCalls.length = 0;
		await resolveDeploymentImageRef(args());
		expect(registryCalls[0]!.registryAuth).toBeUndefined();
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
