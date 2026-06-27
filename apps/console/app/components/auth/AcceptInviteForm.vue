<script setup lang="ts">
import * as z from 'zod';
import { setAccessToken } from '~/utils/token-store';

const props = defineProps<{ token: string }>();

const api = useApi();
const user = useSessionUser();
const rootError = ref<string | null>(null);

const schema = z.object({
	name: z.string().min(1, 'Enter a name.'),
	password: z.string().min(8, 'Use at least 8 characters.')
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: '', password: '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const { accessToken } = await apiData(api.invitations(props.token).accept.post(value)).catch(err => {
				throw new Error(errorCode(err) === 'invite_not_found' ? 'This invite is no longer valid.' : 'Something went wrong — please try again.');
			});
			setAccessToken(accessToken);
			const session = await apiData(api.auth.session.get()).catch(() => null);
			if (!session) {
				rootError.value = 'Signed in, but could not load your session.';
				return;
			}
			user.value = session.user;
			await navigateTo('/', { replace: true });
		} catch (err) {
			rootError.value = err instanceof Error ? err.message : 'Could not reach the server.';
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autocomplete="name" autofocus :disabled="isSubmitting" />
		</Field>
		<Field v-slot="{ componentField }" name="password" label="Password">
			<Input v-bind="componentField" type="password" autocomplete="new-password" placeholder="••••••••" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" role="alert" class="text-sm text-destructive">{{ rootError }}</p>

		<Button type="submit" class="mt-1 w-full" :disabled="isSubmitting">{{ isSubmitting ? 'Joining…' : 'Accept invite' }}</Button>
	</AppForm>
</template>
