// Clamps page into range as the source shrinks instead of resetting to 1, so a background refetch doesn't yank the user off their page.
export function usePagedList<T>(source: MaybeRefOrGetter<T[]>, pageSize: number) {
	const page = ref(1);

	const pageCount = computed(() => Math.max(1, Math.ceil(toValue(source).length / pageSize)));

	watch(pageCount, count => {
		if (page.value > count) page.value = count;
	});

	const paged = computed(() => {
		const start = (page.value - 1) * pageSize;
		return toValue(source).slice(start, start + pageSize);
	});

	return { page, pageCount, paged };
}
