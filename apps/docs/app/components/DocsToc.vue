<script setup lang="ts">
import type { TocLink } from '~/utils/docs-types';

defineProps<{
	readonly links?: readonly TocLink[];
}>();
</script>

<template>
	<nav v-if="links?.length" class="space-y-3 text-sm" aria-label="On this page">
		<p class="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">On this page</p>
		<ul class="space-y-2 border-l pl-4">
			<li v-for="link in links" :key="link.id" class="space-y-2">
				<a class="block text-muted-foreground transition-colors hover:text-primary-text" :href="`#${link.id}`">{{ link.text }}</a>
				<ul v-if="link.children?.length" class="space-y-2 pl-3">
					<li v-for="child in link.children" :key="child.id">
						<a class="block text-muted-subtle transition-colors hover:text-primary-text" :href="`#${child.id}`">{{ child.text }}</a>
					</li>
				</ul>
			</li>
		</ul>
	</nav>
</template>
