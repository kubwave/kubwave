<script setup lang="ts">
import * as z from 'zod';
import type { ProjectDetail } from '~/utils/types';

const props = defineProps<{ project: ProjectDetail }>();
const emit = defineEmits<{ done: [] }>();

const updateProject = useUpdateProject(() => props.project);
const toast = useToast();
const rootError = ref<string | null>(null);

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a project name.'),
	description: z.string()
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: props.project.name, description: props.project.description ?? '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			await updateProject.mutateAsync({ name: value.name, description: value.description });
			toast.success('Project saved');
			emit('done');
		} catch (err) {
			rootError.value = errorCode(err) === 'project_name_taken' ? 'A project with that name already exists.' : 'Could not save project.';
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" :disabled="isSubmitting" />
		</Field>
		<Field v-slot="{ componentField }" name="description" label="Description">
			<Textarea v-bind="componentField" :rows="3" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex justify-end gap-2">
			<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Saving…' : 'Save changes' }}</Button>
		</div>
	</AppForm>
</template>
