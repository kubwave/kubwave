<script setup lang="ts">
import { TabsContent } from '~/components/ui/tabs';
import { contentTabsKey } from './tabs-context';

const props = defineProps<{
	readonly label: string;
}>();

const tabs = inject(contentTabsKey);
const value = tabs?.register() ?? props.label;
</script>

<template>
	<TabsContent v-if="tabs" :value="value" class="mt-0 rounded-lg border bg-background p-4">
		<div class="space-y-4">
			<slot />
		</div>
	</TabsContent>
	<section v-else class="rounded-lg border bg-background p-4">
		<p class="mb-3 text-xs font-semibold tracking-[0.14em] text-primary-text uppercase">{{ label }}</p>
		<div class="space-y-4">
			<slot />
		</div>
	</section>
</template>
