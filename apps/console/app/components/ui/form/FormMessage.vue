<script lang="ts" setup>
import type { HTMLAttributes } from 'vue';
import { computed } from 'vue';
import { cn } from '~/lib/utils';
import { useFormField } from './useFormField';

const props = defineProps<{ errors?: unknown[]; show?: boolean; class?: HTMLAttributes['class'] }>();
const { formMessageId } = useFormField();

// Standard-Schema errors may be strings or { message } objects — normalize to the first message.
const message = computed(() => {
	const first = props.errors?.[0];
	if (first == null) return '';
	return typeof first === 'string' ? first : ((first as { message?: string }).message ?? '');
});
</script>

<template>
	<p v-if="props.show && message" :id="formMessageId" data-slot="form-message" :class="cn('text-destructive text-sm', props.class)">
		{{ message }}
	</p>
</template>
