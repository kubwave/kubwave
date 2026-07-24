import { useLocalStorage } from '@vueuse/core';

// Desktop rail collapse state, persisted across sessions. Applied only after mount so SSR
// always renders the expanded rail (avoids hydration mismatches on the width classes).
export function useSidebar() {
	const stored = useLocalStorage('kubwave-sidebar-collapsed', false);
	const mounted = ref(false);
	onMounted(() => (mounted.value = true));

	const collapsed = computed(() => mounted.value && stored.value);

	function toggle() {
		stored.value = !stored.value;
	}

	return { collapsed, toggle };
}
