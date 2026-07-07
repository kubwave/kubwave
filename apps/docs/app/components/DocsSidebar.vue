<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import type { NavGroup } from '~/utils/navigation';
import { cn } from '~/lib/utils';
import { normalizeDocsPath } from '~/utils/navigation';

const props = defineProps<{
	readonly groups: readonly NavGroup[];
	readonly class?: HTMLAttributes['class'];
}>();

const route = useRoute();
const activePath = computed(() => normalizeDocsPath(route.path));
</script>

<template>
	<nav :class="cn('space-y-8 text-sm', props.class)" aria-label="Docs navigation">
		<div v-for="(group, i) in groups" :key="group.title" :class="cn('space-y-3', i > 0 && 'border-t border-border pt-6')">
			<p class="mt-1 px-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{{ group.title }}</p>
			<ul class="space-y-1">
				<li v-for="item in group.items" :key="item.path">
					<NuxtLink
						:to="item.path"
						:aria-current="activePath === item.path ? 'page' : undefined"
						:class="
							cn(
								'sidebar-link block rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
								activePath === item.path && 'sidebar-link-active'
							)
						"
					>
						{{ item.title }}
					</NuxtLink>
				</li>
			</ul>
		</div>
	</nav>
</template>
