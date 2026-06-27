<script setup lang="ts">
import * as z from 'zod';
import { Send } from 'lucide-vue-next';

const emit = defineEmits<{ done: [] }>();

const schema = z.object({
	email: z.string().trim().min(1, 'Enter an email.').email('Enter a valid email address.'),
	isAdmin: z.boolean()
});

const { form, isSubmitting, setFieldError } = useAppForm({
	schema,
	defaultValues: { email: '', isAdmin: false },
	onSubmit: ({ value }) => {
		invite.mutate({ email: value.email, isAdmin: value.isAdmin });
	}
});

const { invite } = useInviteUser({
	onDone: () => emit('done'),
	onEmailInUse: () => setFieldError('email', 'A user with this email already exists.')
});

const pending = computed(() => invite.isPending.value || isSubmitting.value);
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="email" label="Email">
			<Input v-bind="componentField" type="email" placeholder="person@example.com" autocomplete="off" :disabled="pending" />
		</Field>

		<Field v-slot="{ componentField }" name="isAdmin">
			<div class="flex items-center justify-between gap-3">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm font-medium">Grant admin access</span>
					<span class="text-xs text-muted-foreground">Admins can manage users, settings, and platform updates.</span>
				</div>
				<Switch v-bind="componentField" :disabled="pending" />
			</div>
		</Field>

		<div class="flex justify-end gap-2 pt-1">
			<Button type="button" variant="ghost" :disabled="pending" @click="emit('done')">Cancel</Button>
			<Button type="submit" :disabled="pending">
				<Send v-if="!pending" />
				{{ pending ? 'Sending…' : 'Send invite' }}
			</Button>
		</div>
	</AppForm>
</template>
