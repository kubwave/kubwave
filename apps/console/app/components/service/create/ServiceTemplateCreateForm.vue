<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { TemplateListItem } from '~/composables/use-templates';

const props = defineProps<{ environmentId: string; template: TemplateListItem }>();
const emit = defineEmits<{ created: [Service[]]; back: []; done: [] }>();

// Name + one field per declared template input. All inputs are strings in the MVP.
const schemaShape: Record<string, z.ZodTypeAny> = {
	name: z.string().trim().min(1, 'Enter a name.')
};
for (const input of props.template.inputs) {
	schemaShape[input.key] = input.required ? z.string().trim().min(1, `${input.label} is required.`) : z.string().trim().optional().default('');
}

const initialValues: Record<string, string> = { name: props.template.id };
for (const input of props.template.inputs) initialValues[input.key] = input.default ?? '';

const rootError = ref<string | null>(null);
const api = useApi();
const toast = useToast();

function createError(err: unknown): string {
	if (errorCode(err) === 'template_input_required') return 'Please fill in all required fields.';
	return serviceErrorMessage(err, 'Could not create from template.');
}

const { form, isSubmitting } = useAppForm({
	schema: z.object(schemaShape),
	defaultValues: initialValues,
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const inputs: Record<string, string> = {};
			for (const input of props.template.inputs) inputs[input.key] = (value[input.key] as string) ?? '';
			const services = await apiData(
				api.environments(props.environmentId).services.fromTemplate.post({
					templateId: props.template.id,
					name: value.name as string,
					inputs
				})
			).catch(err => {
				rootError.value = createError(err);
				return null;
			});
			if (!services) return;
			emit('created', services);
			toast.success('Service created');
			emit('done');
		} catch {
			rootError.value = 'Could not reach the server.';
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autofocus :disabled="isSubmitting" />
		</Field>

		<Field v-for="input in template.inputs" :key="input.key" v-slot="{ componentField }" :name="input.key" :label="input.label">
			<Input v-bind="componentField" :placeholder="input.placeholder" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="isSubmitting" @click="emit('back')">
				<ArrowLeft />
				Back
			</Button>
			<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Creating…' : 'Create service' }}</Button>
		</div>
	</AppForm>
</template>
