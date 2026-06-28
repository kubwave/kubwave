<script setup lang="ts">
import * as z from 'zod';

const api = useApi();
const submitted = ref(false);
const rootError = ref<string | null>(null);

const schema = z.object({
	email: z.string().min(1, 'Enter your email.').email('Enter a valid email address.')
});

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { email: '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			await apiData(api.auth.forgotPassword.post(value));
			submitted.value = true;
		} catch {
			rootError.value = 'Could not reach the server — please try again.';
		}
	}
});
</script>

<template>
	<div v-if="submitted" class="flex flex-col gap-4">
		<p class="text-sm text-muted-subtle">If an account exists for that email, we've sent a link to reset your password. Check your inbox.</p>
		<Button variant="outline" class="w-full" as-child>
			<NuxtLink to="/auth/login">Back to sign in</NuxtLink>
		</Button>
	</div>
	<AppForm v-else :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="email" label="Email">
			<Input v-bind="componentField" type="email" autocomplete="email" autofocus placeholder="you@example.com" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" role="alert" class="text-sm text-destructive">{{ rootError }}</p>

		<Button type="submit" class="mt-1 w-full" :disabled="isSubmitting">{{ isSubmitting ? 'Sending…' : 'Send reset link' }}</Button>
		<Button variant="ghost" class="w-full" as-child>
			<NuxtLink to="/auth/login">Back to sign in</NuxtLink>
		</Button>
	</AppForm>
</template>
