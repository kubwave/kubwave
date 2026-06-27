<script setup lang="ts">
import * as z from 'zod';
import { FolderPlus } from 'lucide-vue-next';

const props = defineProps<{ teamId: string }>();
const emit = defineEmits<{ done: [] }>();

const createProject = useCreateProject(() => props.teamId);
const toast = useToast();
const rootError = ref<string | null>(null);

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a project name.'),
	description: z.string().trim().optional()
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: '', description: '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		const project = await createProject.mutateAsync({ name: value.name, description: value.description || undefined }).catch((err: unknown) => {
			const code = errorCode(err);
			rootError.value =
				code === 'project_name_taken'
					? 'A project with that name already exists in this team.'
					: code === 'team_not_found'
						? 'This team is no longer available to you.'
						: 'Could not create project. Please try again.';
			return null;
		});
		if (!project) return;
		toast.success('Project created', `${project.name} is ready.`);
		emit('done');
		// A routing failure must not surface as a create error: the project was created and already shows in the list.
		try {
			await navigateTo(`/team/projects/${project.id}`);
		} catch {
			// ignored — navigation is best-effort once the project exists
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" placeholder="My app" autocomplete="off" autofocus :disabled="isSubmitting" />
		</Field>
		<Field v-slot="{ componentField }" name="description" label="Description">
			<Textarea v-bind="componentField" placeholder="Optional" :rows="3" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex justify-end gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="isSubmitting" @click="emit('done')">Cancel</Button>
			<Button type="submit" :disabled="isSubmitting">
				<FolderPlus v-if="!isSubmitting" />
				{{ isSubmitting ? 'Creating…' : 'Create project' }}
			</Button>
		</div>
	</AppForm>
</template>
