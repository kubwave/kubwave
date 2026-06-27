<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft } from 'lucide-vue-next';
import type { Service } from '~/utils/types';

// A compose file can create MANY services → emits `created` with the array.
const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ created: [Service[]]; back: []; done: [] }>();

const schema = z.object({
	compose: z.string().trim().min(1, 'Paste a Docker Compose file.').max(200_000, 'Compose file is too large.')
});

const COMPOSE_PLACEHOLDER = `services:
  web:
    image: ghcr.io/acme/web:latest
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: production
  worker:
    image: ghcr.io/acme/worker:latest`;

const rootError = ref<string | null>(null);

const api = useApi();
const toast = useToast();

function readErrorMessage(err: unknown): string {
	if (err && typeof err === 'object') {
		const body = err as { error?: string; details?: { message?: string } };
		if (body.details?.message) return body.details.message;
		if (body.error === 'service_name_taken') return 'One or more services already exist in this environment.';
		if (body.error === 'compose_import_failed' || body.error === 'validation_error') return 'Could not import this Compose file.';
	}
	return 'Could not import services.';
}

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { compose: '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const services = await apiData(api.environments(props.environmentId).services.compose.post({ compose: value.compose })).catch(err => {
				rootError.value = readErrorMessage(err);
				return null;
			});
			if (!services) return;
			emit('created', services);
			toast.success(`Imported ${services.length} service${services.length === 1 ? '' : 's'}`);
			emit('done');
		} catch {
			rootError.value = 'Could not reach the server.';
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field
			v-slot="{ componentField }"
			name="compose"
			label="Compose file"
			description="Imports each Compose service as a separate Docker image service. Build, networks, and dependencies are ignored. Named volumes are imported; bind mounts are ignored."
		>
			<ClientOnly>
				<ServiceCodeEditor
					:model-value="componentField.modelValue"
					autofocus
					filename="docker-compose.yml"
					language-label="YAML"
					:placeholder="COMPOSE_PLACEHOLDER"
					:disabled="isSubmitting"
					@update:model-value="componentField['onUpdate:modelValue']"
				/>
				<template #fallback>
					<Skeleton class="h-80 w-full rounded-md" />
				</template>
			</ClientOnly>
		</Field>

		<p v-if="rootError" class="text-sm whitespace-pre-line text-destructive">{{ rootError }}</p>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="isSubmitting" @click="emit('back')">
				<ArrowLeft />
				Back
			</Button>
			<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Importing…' : 'Import services' }}</Button>
		</div>
	</AppForm>
</template>
