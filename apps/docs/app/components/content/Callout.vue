<script setup lang="ts">
import { CircleAlert, Info, Lightbulb, TriangleAlert } from 'lucide-vue-next';

const props = withDefaults(
	defineProps<{
		readonly type?: string;
		readonly title?: string;
	}>(),
	{ type: 'note' }
);

const iconComponent = computed(() => {
	switch (props.type) {
		case 'tip':
			return Lightbulb;
		case 'caution':
			return TriangleAlert;
		case 'danger':
			return CircleAlert;
		default:
			return Info;
	}
});

const toneClass = computed(() => {
	switch (props.type) {
		case 'tip':
			return 'border-success/40 bg-success/10 text-success-foreground';
		case 'caution':
			return 'border-warning/45 bg-warning/10 text-warning-foreground';
		case 'danger':
			return 'border-destructive/45 bg-destructive/10 text-destructive';
		default:
			return 'border-info/45 bg-info/10 text-primary-text';
	}
});
</script>

<template>
	<aside :class="['my-6 rounded-xl border p-4', toneClass]">
		<div class="flex gap-3">
			<component :is="iconComponent" class="mt-1 size-4 shrink-0" aria-hidden="true" />
			<div class="min-w-0 space-y-2 text-sm leading-6">
				<p v-if="title" class="font-semibold text-foreground">{{ title }}</p>
				<div class="text-foreground/90">
					<slot />
				</div>
			</div>
		</div>
	</aside>
</template>
