<script setup lang="ts">
import * as z from 'zod';
import { useQueryClient } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';

const props = defineProps<{ teamId: string }>();
const emit = defineEmits<{ done: [] }>();

function errorMessage(error: string): { title: string; description: string } {
	switch (error) {
		case 'user_not_found':
			return { title: 'No user with that email', description: 'The person must already have an account.' };
		case 'already_member':
			return { title: 'Already a member', description: 'That person is already in this team.' };
		case 'team_forbidden':
			return { title: 'Not allowed', description: 'Only owners can add members.' };
		default:
			return { title: 'Could not add member', description: 'Please try again.' };
	}
}

const api = useApi();
const queryClient = useQueryClient();
const toast = useToast();

const schema = z.object({ email: z.string().trim().min(1, 'Enter an email.').email('Enter a valid email address.') });

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { email: '' },
	onSubmit: async ({ value }) => {
		try {
			const member = await apiData(api.teams(props.teamId).members.post({ email: value.email })).catch(err => {
				const { title, description } = errorMessage(errorCode(err));
				toast.error(title, description);
				return null;
			});
			if (!member) return;
			await queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(props.teamId) });
			toast.success('Member added', `${member.email} was added to the team.`);
			emit('done');
		} catch {
			toast.error('Could not add member', 'Could not reach the server.');
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="email" label="Email">
			<Input v-bind="componentField" type="email" placeholder="person@example.com" autocomplete="off" autofocus :disabled="isSubmitting" />
		</Field>

		<div class="flex justify-end gap-2">
			<Button type="button" variant="outline" :disabled="isSubmitting" @click="emit('done')">Cancel</Button>
			<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Adding…' : 'Add member' }}</Button>
		</div>
	</AppForm>
</template>
