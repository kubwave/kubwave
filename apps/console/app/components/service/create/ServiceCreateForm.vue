<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft } from 'lucide-vue-next';
import type { Service } from '~/utils/types';

const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ created: [Service]; back: []; done: [] }>();

// Split "registry/image:tag"; the tag colon must come after the last slash so a registry port isn't mistaken for a tag.
function parseImageRef(value: string): { image: string; tag: string } | null {
	const ref = value.trim();
	const lastSlash = ref.lastIndexOf('/');
	const lastColon = ref.lastIndexOf(':');
	if (!ref || lastColon <= lastSlash || lastColon === ref.length - 1) return null;
	const image = ref.slice(0, lastColon).trim();
	const tag = ref.slice(lastColon + 1).trim();
	return image && tag ? { image, tag } : null;
}

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a service name.'),
	imageRef: z
		.string()
		.trim()
		.min(1, 'Enter an image.')
		.refine(value => parseImageRef(value) !== null, 'Use the form registry/image:tag.'),
	description: z.string().optional()
});

const rootError = ref<string | null>(null);

const toast = useToast();
const createService = useCreateService(() => props.environmentId);

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: '', imageRef: '', description: '' },
	onSubmit: async ({ value }) => {
		const parsed = parseImageRef(value.imageRef);
		if (!parsed) return;
		rootError.value = null;
		try {
			const service = await createService.mutateAsync({
				name: value.name,
				description: value.description ?? '',
				type: 'docker-image',
				config: { image: parsed.image, tag: parsed.tag, containerPort: null, env: [], domains: [], volumes: [] }
			});
			emit('created', service);
			toast.success('Service created');
			emit('done');
		} catch (err) {
			rootError.value = serviceErrorMessage(err, 'Could not create service.');
		}
	}
});
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autofocus placeholder="web" :disabled="isSubmitting" />
		</Field>

		<Field v-slot="{ componentField }" name="imageRef" label="Image">
			<Input v-bind="componentField" placeholder="ghcr.io/acme/web:latest" class="font-mono text-xs" :disabled="isSubmitting" />
		</Field>

		<Field v-slot="{ componentField }" name="description" label="Description">
			<Input v-bind="componentField" placeholder="Customer-facing web service" :disabled="isSubmitting" />
		</Field>

		<p v-if="rootError" class="text-sm text-destructive">{{ rootError }}</p>

		<div class="flex items-center justify-between gap-2 pt-2">
			<Button type="button" variant="ghost" :disabled="isSubmitting" @click="emit('back')">
				<ArrowLeft />
				Back
			</Button>
			<Button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Creating…' : 'Create service' }}</Button>
		</div>
	</AppForm>
</template>
