<script setup lang="ts">
import * as z from 'zod';
import { Plus } from 'lucide-vue-next';

const emit = defineEmits<{ created: [{ id: string; name: string }]; done: [] }>();

const createTeam = useCreateTeam();
const toast = useToast();

const schema = z.object({ name: z.string().trim().min(1, 'Enter a team name.') });

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: '' },
	onSubmit: async ({ value }) => {
		try {
			const team = await createTeam.mutateAsync(value.name);
			toast.success('Team created', `${team.name} is now ready.`);
			emit('created', team);
			emit('done');
		} catch {
			toast.error('Could not create team', 'Please try again.');
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Team name">
			<Input v-bind="componentField" placeholder="Acme Inc." autocomplete="off" autofocus />
		</Field>

		<div class="flex justify-end gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="isSubmitting" @click="emit('done')">Cancel</Button>
			<Button type="submit" :disabled="isSubmitting">
				<Plus v-if="!isSubmitting" />
				{{ isSubmitting ? 'Creating…' : 'Create team' }}
			</Button>
		</div>
	</AppForm>
</template>
