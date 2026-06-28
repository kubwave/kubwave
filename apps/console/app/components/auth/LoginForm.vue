<script setup lang="ts">
import * as z from 'zod';
import { setAccessToken } from '~/utils/token-store';

const api = useApi();
const user = useSessionUser();
const route = useRoute();
const rootError = ref<string | null>(null);
const justReset = computed(() => route.query.reset === '1');

const schema = z.object({
	email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.'),
	password: z.string().min(1, 'Enter your password.')
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { email: '', password: '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const { accessToken } = await apiData(api.auth.login.post(value)).catch(err => {
				throw new Error(errorCode(err) === 'invalid_credentials' ? 'Invalid email or password.' : 'Something went wrong — please try again.');
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
		<p v-if="justReset" class="text-sm text-muted-subtle">Your password was updated. Sign in with your new password.</p>
		<Field v-slot="{ componentField }" name="email" label="Email">
			<Input v-bind="componentField" type="email" autocomplete="email" autofocus placeholder="you@example.com" :disabled="isSubmitting" />
		</Field>
		<Field name="password" label="Password">
			<template #label-action>
				<NuxtLink to="/auth/forgot" class="text-sm font-medium text-primary-text hover:underline">Forgot password?</NuxtLink>
			</template>
			<template #default="{ componentField }">
				<Input v-bind="componentField" type="password" autocomplete="current-password" placeholder="••••••••" :disabled="isSubmitting" />
			</template>
		</Field>

		<p v-if="rootError" role="alert" class="text-sm text-destructive">{{ rootError }}</p>

		<Button type="submit" class="mt-1 w-full" :disabled="isSubmitting">{{ isSubmitting ? 'Signing in…' : 'Sign in' }}</Button>
	</AppForm>
</template>
