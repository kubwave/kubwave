<script setup lang="ts">
import * as z from 'zod';
import type { Environment } from '~/utils/types';

// Renames the given `environment` when set, otherwise creates a new one under `projectId`.
const props = defineProps<{ projectId: string; environment?: Environment | null }>();
const emit = defineEmits<{ saved: [Environment]; done: [] }>();

const isRename = computed(() => Boolean(props.environment));

const saveEnvironment = useSaveEnvironment(() => props.projectId);
const toast = useToast();
const rootError = ref<string | null>(null);

const schema = z.object({ name: z.string().trim().min(1, 'Enter an environment name.') });

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: props.environment?.name ?? '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const saved = await saveEnvironment.mutateAsync({ name: value.name, environmentId: props.environment?.id ?? null });
			emit('saved', saved);
			toast.success(isRename.value ? 'Environment renamed' : 'Environment created');
			emit('done');
		} catch (err) {
			rootError.value = errorCode(err) === 'environment_name_taken' ? 'An environment with that name already exists.' : 'Could not save environment.';
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autofocus placeholder="production" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex justify-end gap-2 pt-2">
			<Button type="submit" :disabled="isSubmitting">
				{{ isRename ? 'Rename' : 'Create environment' }}
			</Button>
		</div>
	</AppForm>
</template>
