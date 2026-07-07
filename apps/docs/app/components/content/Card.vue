<script setup lang="ts">
import { BookOpen, CheckCircle2, Container, FileText, Github, Lock, Puzzle, Rocket, Settings } from 'lucide-vue-next';

const props = defineProps<{
	readonly title: string;
	readonly icon?: string;
}>();

const iconComponent = computed(() => {
	switch (props.icon) {
		case 'approve-check':
			return CheckCircle2;
		case 'document':
			return FileText;
		case 'github':
			return Github;
		case 'puzzle':
			return Puzzle;
		case 'setting':
			return Settings;
		case 'seti:lock':
			return Lock;
		case 'seti:docker':
			return Container;
		default:
			return props.icon === 'open-book' ? BookOpen : Rocket;
	}
});
</script>

<template>
	<section class="rounded-xl border bg-card p-5 transition-[border-color,background-color] hover:border-primary/50 hover:bg-accent/35">
		<div class="mb-4 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
			<component :is="iconComponent" class="size-4" aria-hidden="true" />
		</div>
		<h3 class="text-base font-semibold text-foreground">{{ title }}</h3>
		<div class="mt-2 text-sm leading-6 text-muted-foreground">
			<slot />
		</div>
	</section>
</template>
