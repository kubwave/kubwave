import { beforeEach, describe, expect, test } from 'bun:test';
import { ref, type Ref } from 'vue';

// Stub Nuxt's useState with a keyed shared ref so useConfirm runs outside a Nuxt runtime (stub before importing).
const stateStore = new Map<string, Ref<unknown>>();
(globalThis as Record<string, unknown>).useState = <T>(key: string, init: () => T): Ref<T> => {
	if (!stateStore.has(key)) stateStore.set(key, ref(init()) as Ref<unknown>);
	return stateStore.get(key) as Ref<T>;
};

const { useConfirm, useConfirmRequest } = await import('../app/composables/use-confirm');

beforeEach(() => {
	stateStore.clear();
});

describe('useConfirm', () => {
	test('resolves true when the request is confirmed', async () => {
		const confirm = useConfirm();
		const request = useConfirmRequest();
		const result = confirm({ title: 'Delete service' });
		expect(request.value?.title).toBe('Delete service');
		request.value!.resolve(true);
		expect(await result).toBe(true);
	});

	test('resolves false when the request is cancelled', async () => {
		const confirm = useConfirm();
		const request = useConfirmRequest();
		const result = confirm({ title: 'Delete service' });
		request.value!.resolve(false);
		expect(await result).toBe(false);
	});

	test('settles an in-flight request as cancelled when a second confirm opens', async () => {
		const confirm = useConfirm();
		const request = useConfirmRequest();
		const first = confirm({ title: 'first' });
		const second = confirm({ title: 'second' });
		// The first promise must settle (false) rather than hang forever.
		expect(await first).toBe(false);
		expect(request.value?.title).toBe('second');
		request.value!.resolve(true);
		expect(await second).toBe(true);
	});
});
