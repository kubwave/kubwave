<script setup lang="ts">
import { Loader2, Save } from 'lucide-vue-next';

// Presentational unsaved-changes bar; consumer wires state + actions. `positionClass` anchors it (sticky on pages, absolute inside fixed-height containers).
const props = withDefaults(defineProps<{ count: number; saving: boolean; canSave: boolean; positionClass?: string }>(), {
	positionClass: 'sticky bottom-4 z-10'
});
defineEmits<{ save: []; discard: [] }>();

const label = computed(() => (props.count === 1 ? '1 unsaved change' : `${props.count} unsaved changes`));
</script>

<template>
	<Transition
		enter-active-class="transition duration-200 ease-out"
		enter-from-class="opacity-0 translate-y-2"
		leave-active-class="transition duration-150 ease-in"
		leave-to-class="opacity-0 translate-y-2"
	>
		<div v-if="count > 0" :class="[positionClass, 'pointer-events-none flex justify-center']">
			<div class="pointer-events-auto flex w-fit max-w-full items-center gap-3 rounded-full bg-accent py-2 pe-2 ps-5 shadow-2xl ring ring-input">
				<span class="flex items-center gap-2 text-sm text-muted-foreground">
					<span class="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
					{{ label }}
				</span>
				<div class="flex items-center gap-1">
					<Button variant="ghost" class="rounded-full" :disabled="saving" @click="$emit('discard')">Discard</Button>
					<Button class="rounded-full" :disabled="!canSave || saving" @click="$emit('save')">
						<Loader2 v-if="saving" class="animate-spin" />
						<Save v-else />
						Save changes
					</Button>
				</div>
			</div>
		</div>
	</Transition>
</template>
