<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next';

const colorMode = useColorMode();
const isDark = computed(() => colorMode.value === 'dark');

function toggleTheme(): void {
	colorMode.preference = isDark.value ? 'light' : 'dark';
}
</script>

<template>
	<Button variant="ghost" size="icon" :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'" @click="toggleTheme">
		<ClientOnly>
			<Sun v-if="isDark" class="size-5" />
			<Moon v-else class="size-5" />
			<template #fallback>
				<span class="size-5" />
			</template>
		</ClientOnly>
	</Button>
</template>
