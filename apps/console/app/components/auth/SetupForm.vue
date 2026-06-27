<script setup lang="ts">
import * as z from 'zod';
import { setAccessToken } from '~/utils/token-store';

const emit = defineEmits<{ done: [] }>();

const api = useApi();
const user = useSessionUser();
const accountError = ref<string | null>(null);

const schema = z.object({
	name: z.string().min(1, 'Enter a name.'),
	email: z.string().min(1, 'Enter an email.').email('Enter a valid email address.'),
	password: z.string().min(8, 'Use at least 8 characters.')
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: '', email: '', password: '' },
	onSubmit: async ({ value }) => {
		accountError.value = null;
		try {
			const { accessToken } = await apiData(api.setup.initialize.post(value)).catch(err => {
				throw new Error(
					errorCode(err) === 'already_initialized' ? 'This platform has already been set up.' : 'Something went wrong — please try again.'
				);
			});
			setAccessToken(accessToken);
			const session = await apiData(api.auth.session.get()).catch(() => null);
			if (!session) {
				accountError.value = 'Signed in, but could not load your session.';
				return;
			}
			user.value = session.user;
			emit('done');
		} catch (err) {
			accountError.value = err instanceof Error ? err.message : 'Could not reach the server.';
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autocomplete="name" autofocus placeholder="Admin" :disabled="isSubmitting" />
		</Field>
		<Field v-slot="{ componentField }" name="email" label="Email">
			<Input v-bind="componentField" type="email" autocomplete="email" placeholder="you@example.com" :disabled="isSubmitting" />
		</Field>
		<Field v-slot="{ componentField }" name="password" label="Password">
			<Input v-bind="componentField" type="password" autocomplete="new-password" placeholder="••••••••" :disabled="isSubmitting" />
		</Field>

		<p v-if="accountError" role="alert" class="text-sm text-destructive">{{ accountError }}</p>

		<Button type="submit" class="mt-1 w-full" :disabled="isSubmitting">{{ isSubmitting ? 'Creating…' : 'Create account' }}</Button>
	</AppForm>
</template>
