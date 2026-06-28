<script setup lang="ts">
import * as z from 'zod';

const props = defineProps<{ token: string }>();

const api = useApi();
const rootError = ref<string | null>(null);
const tokenValid = ref<boolean | null>(null);

onMounted(async () => {
	const result = await apiData(api.auth.resetPassword(props.token).validity.get()).catch(() => null);
	// On a transient error (network / rate-limit), show the form and let the POST be the
	// authoritative check — don't strand a valid token on the "expired" screen.
	tokenValid.value = result ? result.valid : true;
});

const schema = z.object({
	password: z.string().min(12, 'Use at least 12 characters.').max(200, 'Use at most 200 characters.')
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { password: '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			await apiData(api.auth.resetPassword.post({ token: props.token, password: value.password })).catch(err => {
				throw new Error(
					errorCode(err) === 'invalid_reset_token'
						? 'This reset link is no longer valid. Request a new one.'
						: 'Something went wrong — please try again.'
				);
			});
			await navigateTo({ path: '/auth/login', query: { reset: '1' } }, { replace: true });
		} catch (err) {
			rootError.value = err instanceof Error ? err.message : 'Could not reach the server.';
		}
	}
});
</script>

<template>
	<div v-if="tokenValid === false" class="flex flex-col gap-4">
		<p class="text-sm text-destructive">This reset link has expired or already been used.</p>
		<Button variant="outline" class="w-full" as-child>
			<NuxtLink to="/auth/forgot">Request a new link</NuxtLink>
		</Button>
	</div>
	<AppForm v-else :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="password" label="New password">
			<Input
				v-bind="componentField"
				type="password"
				autocomplete="new-password"
				placeholder="••••••••"
				:disabled="isSubmitting || tokenValid === null"
			/>
		</Field>

		<p v-if="rootError" role="alert" class="text-sm text-destructive">{{ rootError }}</p>

		<Button type="submit" class="mt-1 w-full" :disabled="isSubmitting || tokenValid === null">{{
			isSubmitting ? 'Saving…' : 'Set new password'
		}}</Button>
	</AppForm>
</template>
