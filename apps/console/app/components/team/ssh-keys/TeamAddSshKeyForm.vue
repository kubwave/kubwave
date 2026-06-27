<script setup lang="ts">
import * as z from 'zod';
import { useQueryClient } from '@tanstack/vue-query';
import { Sparkles, Upload } from 'lucide-vue-next';
import { queryKeys } from '~/utils/query-keys';

const props = defineProps<{ teamId: string }>();
const emit = defineEmits<{ done: [] }>();

function errorMessage(code: string): { title: string; description: string } {
	switch (code) {
		case 'invalid_ssh_key':
			return { title: 'Invalid key', description: 'That does not look like a valid SSH private key.' };
		case 'ssh_key_passphrase_protected':
			return { title: 'Passphrase-protected key', description: 'Remove the passphrase before uploading — it cannot be used unattended.' };
		case 'ssh_key_name_taken':
			return { title: 'Name already in use', description: 'This team already has an SSH key with that name.' };
		case 'team_forbidden':
			return { title: 'Not allowed', description: 'Only owners can add SSH keys.' };
		default:
			return { title: 'Could not add SSH key', description: 'Please try again.' };
	}
}

const api = useApi();
const queryClient = useQueryClient();
const toast = useToast();

const schema = z
	.object({
		mode: z.enum(['generate', 'upload']),
		name: z.string().trim().min(1, 'Enter a name.').max(100, 'Name is too long.'),
		privateKey: z.string()
	})
	.superRefine((v, ctx) => {
		if (v.mode === 'upload' && !v.privateKey.trim()) {
			ctx.addIssue({ code: 'custom', path: ['privateKey'], message: 'Paste a private key.' });
		}
	});

const { form, isSubmitting, values, setFieldValue } = useAppForm({
	schema,
	defaultValues: { mode: 'generate', name: '', privateKey: '' },
	onSubmit: async ({ value }) => {
		try {
			const body =
				value.mode === 'generate'
					? ({ mode: 'generate', name: value.name.trim() } as const)
					: ({ mode: 'upload', name: value.name.trim(), privateKey: value.privateKey.trim() } as const);
			const key = await apiData(api.teams(props.teamId).sshKeys.post(body)).catch(err => {
				const { title, description } = errorMessage(errorCode(err));
				toast.error(title, description);
				return null;
			});
			if (!key) return;
			await queryClient.invalidateQueries({ queryKey: queryKeys.teamSshKeys(props.teamId) });
			toast.success(
				value.mode === 'generate' ? 'SSH key generated' : 'SSH key added',
				`${key.name} is ready — copy its public key to add it as a deploy key.`
			);
			emit('done');
		} catch {
			toast.error('Could not add SSH key', 'Could not reach the server.');
		}
	}
});

// `values` is a Vue ref → Vue auto-unwraps it in the template, so `values.value.X`
// is undefined there. Read template-facing form values through a computed instead.
const mode = computed(() => values.value.mode);
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Tabs :model-value="mode" @update:model-value="m => setFieldValue('mode', m)">
			<TabsList class="w-full">
				<TabsTrigger value="generate">
					<Sparkles />
					Generate
				</TabsTrigger>
				<TabsTrigger value="upload">
					<Upload />
					Upload
				</TabsTrigger>
			</TabsList>
		</Tabs>

		<Field v-slot="{ componentField }" name="name" label="Name" description='A label to recognise this key by, e.g. "gitea-deploy".'>
			<Input v-bind="componentField" placeholder="gitea-deploy" autocomplete="off" autofocus :disabled="isSubmitting" />
		</Field>

		<Field
			v-if="mode === 'upload'"
			v-slot="{ componentField }"
			name="privateKey"
			label="Private key"
			description="OpenSSH or PEM private key. Passphrase-protected keys are not accepted."
		>
			<Textarea
				v-bind="componentField"
				:rows="6"
				placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…"
				:disabled="isSubmitting"
				class="font-mono text-xs"
			/>
		</Field>

		<p v-else class="text-sm text-muted-foreground">
			A fresh ed25519 keypair is generated on the server. The private key is stored encrypted and never leaves the platform — you only copy the public
			key.
		</p>

		<div class="flex justify-end gap-2">
			<Button type="button" variant="outline" :disabled="isSubmitting" @click="emit('done')">Cancel</Button>
			<Button type="submit" :disabled="isSubmitting">
				{{ isSubmitting ? 'Saving…' : mode === 'generate' ? 'Generate key' : 'Add key' }}
			</Button>
		</div>
	</AppForm>
</template>
