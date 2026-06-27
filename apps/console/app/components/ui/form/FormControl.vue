<script lang="ts" setup>
import { Slot } from 'reka-ui';
import { useFormField } from './useFormField';

const props = defineProps<{ invalid?: boolean }>();
const { formItemId, formDescriptionId, formMessageId } = useFormField();
</script>

<template>
	<Slot
		:id="formItemId"
		data-slot="form-control"
		:aria-describedby="!props.invalid ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`"
		:aria-invalid="!!props.invalid"
	>
		<slot />
	</Slot>
</template>
