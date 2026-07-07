<script setup lang="ts">
import { TabsRoot } from 'reka-ui';
import type { VNode } from 'vue';
import { TabsList, TabsTrigger } from '~/components/ui/tabs';
import { contentTabsKey, type ContentTabItem } from './tabs-context';

const slots = useSlots();

const items = computed<readonly ContentTabItem[]>(() => {
	const result: ContentTabItem[] = [];
	for (const node of (slots.default?.() ?? []) as VNode[]) {
		const label = node.props?.label;
		if (typeof label === 'string') result.push({ value: `tab-${result.length}`, label });
	}
	return result;
});

const activeValue = ref(items.value[0]?.value);

let nextIndex = 0;
function register(): string {
	const value = `tab-${nextIndex}`;
	nextIndex += 1;
	return value;
}

provide(contentTabsKey, { activeValue, register });
</script>

<template>
	<TabsRoot v-model="activeValue" class="my-6 flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
		<TabsList v-if="items.length" class="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/70 p-1">
			<TabsTrigger v-for="item in items" :key="item.value" :value="item.value" class="min-w-24 flex-none px-3">
				{{ item.label }}
			</TabsTrigger>
		</TabsList>
		<slot />
	</TabsRoot>
</template>
