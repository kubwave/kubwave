import { describe, expect, mock, test } from 'bun:test';

const { checkCluster, checkHelmRelease, runPreflightChecks } = await import('../src/lib/preflight.js');

describe('preflight checks', () => {
	describe('checkCluster', () => {
		test('returns ok when cluster is reachable', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespace: mock(async () => ({ items: [] }))
				})
			} as never;

			const result = await checkCluster(kc);
			expect(result).toMatchObject({ ok: true, label: 'Cluster', message: 'Cluster reachable' });
		});

		test('returns failure when cluster is unreachable', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespace: mock(async () => {
						throw new Error('connection refused');
					})
				})
			} as never;

			const result = await checkCluster(kc);
			expect(result).toMatchObject({ ok: false, label: 'Cluster' });
			expect(result.message).toContain('Cluster not reachable');
		});

		test('handles non-error throwables', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespace: mock(async () => {
						throw 'unknown error';
					})
				})
			} as never;

			const result = await checkCluster(kc);
			expect(result.ok).toBe(false);
			expect(result.message).toContain('unknown error');
		});
	});

	describe('checkHelmRelease', () => {
		test('detects existing helm release', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespacedSecret: mock(async () => ({
						items: [{ metadata: { name: 'sh.helm.release.v1.kubwave.v1' } }]
					}))
				})
			} as never;

			const result = await checkHelmRelease(kc);
			expect(result).toMatchObject({ ok: true, label: 'Helm-Release' });
			expect(result.message).toContain('Existing Helm release');
		});

		test('returns fresh install for no release', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespacedSecret: mock(async () => ({
						items: []
					}))
				})
			} as never;

			const result = await checkHelmRelease(kc);
			expect(result).toMatchObject({ ok: true, label: 'Helm-Release' });
			expect(result.message).toContain('fresh installation');
		});

		test('returns fresh install when namespace not found', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespacedSecret: mock(async () => {
						throw { code: 404 };
					})
				})
			} as never;

			const result = await checkHelmRelease(kc);
			expect(result).toMatchObject({ ok: true, label: 'Helm-Release' });
			expect(result.message).toContain('fresh installation');
		});

		test('returns failure on unexpected errors', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespacedSecret: mock(async () => {
						throw new Error('forbidden');
					})
				})
			} as never;

			const result = await checkHelmRelease(kc);
			expect(result).toMatchObject({ ok: false, label: 'Helm-Release' });
			expect(result.message).toContain('Helm release check failed');
		});
	});

	describe('runPreflightChecks', () => {
		test('returns all passed when all checks pass', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespace: mock(async () => ({ items: [] })),
					listNamespacedSecret: mock(async () => ({ items: [] }))
				})
			} as never;

			const result = await runPreflightChecks(kc);
			expect(result.allPassed).toBe(true);
			expect(result.results).toHaveLength(2);
		});

		test('returns not all passed when a check fails', async () => {
			const kc = {
				makeApiClient: () => ({
					listNamespace: mock(async () => {
						throw new Error('connection refused');
					}),
					listNamespacedSecret: mock(async () => ({ items: [] }))
				})
			} as never;

			const result = await runPreflightChecks(kc);
			expect(result.allPassed).toBe(false);
			expect(result.results).toHaveLength(2);
		});
	});
});
