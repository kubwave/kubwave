import { describe, expect, mock, test } from 'bun:test';

const logs: string[] = [];
const cancelled = Symbol('cancelled');
let confirmAnswer: boolean | symbol = true;

// Capture the list-call args to assert the exact label selectors / namespace reach the client (a dropped selector would otherwise go undetected).
interface ListCall {
	namespace?: string;
	labelSelector?: string;
}

mock.module('@clack/prompts', () => ({
	log: {
		warn: (msg: string) => logs.push(`warn:${msg}`)
	},
	confirm: async () => confirmAnswer,
	isCancel: (value: unknown) => value === cancelled
}));

const { checkAdoption } = await import('../src/lib/adoption.js');

describe('checkAdoption', () => {
	test('returns no orphans when namespace does not exist', async () => {
		const kc = {
			makeApiClient: () => ({
				readNamespace: async () => {
					throw { code: 404 };
				}
			})
		} as never;

		const result = await checkAdoption(kc);
		expect(result).toEqual({ hasOrphans: false, reuseData: false });
	});

	test('returns no orphans when namespace exists with helm release and no orphan PVCs', async () => {
		const kc = {
			makeApiClient: () => ({
				readNamespace: async () => ({}),
				listNamespacedPersistentVolumeClaim: async () => ({ items: [] }),
				listNamespacedSecret: async () => ({
					items: [{ metadata: { name: 'sh.helm.release.v1.kubwave.v1' } }]
				})
			})
		} as never;

		const result = await checkAdoption(kc);
		expect(result).toEqual({ hasOrphans: false, reuseData: false });
	});

	test('returns no orphans when PVCs exist but helm release also present', async () => {
		const kc = {
			makeApiClient: () => ({
				readNamespace: async () => ({}),
				listNamespacedPersistentVolumeClaim: async () => ({
					items: [{ metadata: { name: 'postgres-data' } }]
				}),
				listNamespacedSecret: async () => ({
					items: [{ metadata: { name: 'sh.helm.release.v1.kubwave.v1' } }]
				})
			})
		} as never;

		const result = await checkAdoption(kc);
		expect(result).toEqual({ hasOrphans: false, reuseData: false });
	});

	test('prompts for reuse when orphaned PVCs detected', async () => {
		logs.length = 0;
		confirmAnswer = true;
		const captured: { pvc?: ListCall; secret?: ListCall } = {};

		const kc = {
			makeApiClient: () => ({
				readNamespace: async () => ({}),
				listNamespacedPersistentVolumeClaim: async (call: ListCall) => {
					captured.pvc = call;
					return { items: [{ metadata: { name: 'postgres-data' } }] };
				},
				listNamespacedSecret: async (call: ListCall) => {
					captured.secret = call;
					return { items: [] };
				}
			})
		} as never;

		const result = await checkAdoption(kc);
		expect(result).toEqual({ hasOrphans: true, reuseData: true });

		// Both list calls must be scoped to the kubwave namespace with the exact label selectors.
		expect(captured.pvc).toEqual({
			namespace: 'kubwave',
			labelSelector: 'app.kubernetes.io/part-of=kubwave'
		});
		expect(captured.secret).toEqual({
			namespace: 'kubwave',
			labelSelector: 'owner=helm,name=kubwave'
		});
	});

	test('returns no orphans when user cancels the reuse prompt', async () => {
		logs.length = 0;
		confirmAnswer = cancelled;

		const kc = {
			makeApiClient: () => ({
				readNamespace: async () => ({}),
				listNamespacedPersistentVolumeClaim: async () => ({
					items: [{ metadata: { name: 'postgres-data' } }]
				}),
				listNamespacedSecret: async () => ({ items: [] })
			})
		} as never;

		// Source throws UserCancelledError on cancel, but its outer catch swallows it → { false, false }. This locks in the swallow; update if the catch is tightened.
		const result = await checkAdoption(kc);
		expect(result).toEqual({ hasOrphans: false, reuseData: false });
	});

	test('returns no orphans when user declines reuse', async () => {
		logs.length = 0;
		confirmAnswer = false;

		const kc = {
			makeApiClient: () => ({
				readNamespace: async () => ({}),
				listNamespacedPersistentVolumeClaim: async () => ({
					items: [{ metadata: { name: 'postgres-data' } }]
				}),
				listNamespacedSecret: async () => ({ items: [] })
			})
		} as never;

		// Source throws FatalCliError on decline, but its outer catch swallows it → { false, false }. This locks in the swallow; update if the catch is tightened.
		const result = await checkAdoption(kc);
		expect(result).toEqual({ hasOrphans: false, reuseData: false });
	});

	test('recovers from errors reading resources gracefully', async () => {
		const kc = {
			makeApiClient: () => ({
				readNamespace: async () => ({}),
				listNamespacedPersistentVolumeClaim: async () => {
					throw new Error('network error');
				}
			})
		} as never;

		const result = await checkAdoption(kc);
		expect(result).toEqual({ hasOrphans: false, reuseData: false });
	});
});
