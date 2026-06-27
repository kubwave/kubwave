<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { provide } from 'vue';
import type { AnyFormApi } from '@tanstack/vue-form';
import { APP_FORM_KEY } from './form-context';

const props = defineProps<{ form: AnyFormApi; class?: HTMLAttributes['class'] }>();
provide(APP_FORM_KEY, props.form);

function onSubmit(event: Event) {
	event.preventDefault();
	event.stopPropagation();
	props.form.handleSubmit();
}
</script>

<template>
	<form :class="props.class" @submit="onSubmit">
		<slot />
	</form>
</template>
