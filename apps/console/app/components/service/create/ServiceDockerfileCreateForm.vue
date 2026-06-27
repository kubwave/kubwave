<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft } from 'lucide-vue-next';
import type { Service } from '~/utils/types';

const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ created: [Service]; back: []; done: [] }>();

// Matches the API's dockerfileConfigSchema: a Dockerfile must contain a FROM instruction.
const hasFrom = (dockerfile: string) => dockerfile.split('\n').some(line => /^\s*FROM\s+\S+/i.test(line));

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a service name.'),
	dockerfile: z.string().trim().min(1, 'Paste a Dockerfile.').refine(hasFrom, 'A Dockerfile must contain a FROM instruction.'),
	description: z.string().optional()
});

const DOCKERFILE_PLACEHOLDER = `FROM nginx:1.27-alpine
RUN echo "<h1>Hello from a built image</h1>" > /usr/share/nginx/html/index.html`;

const rootError = ref<string | null>(null);

const toast = useToast();
const createService = useCreateService(() => props.environmentId);

const { form, isSubmitting } = useAppForm({
	schema,
	defaultValues: { name: '', dockerfile: '', description: '' },
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const service = await createService.mutateAsync({
				name: value.name,
				description: value.description ?? '',
				type: 'dockerfile',
				config: { dockerfile: value.dockerfile, containerPort: null, env: [], domains: [], volumes: [] }
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

		<div class="flex flex-col gap-2">
			<Field v-slot="{ componentField }" name="dockerfile" label="Dockerfile">
				<ClientOnly>
					<ServiceCodeEditor
						:model-value="componentField.modelValue"
						filename="Dockerfile"
						language-label="Dockerfile"
						:placeholder="DOCKERFILE_PLACEHOLDER"
						:disabled="isSubmitting"
						@update:model-value="componentField['onUpdate:modelValue']"
					/>
					<template #fallback>
						<Skeleton class="h-80 w-full rounded-md" />
					</template>
				</ClientOnly>
			</Field>
			<p class="text-xs text-muted-foreground">
				The platform builds this Dockerfile and runs the image. No build context is uploaded, so it must be self-contained —
				<code class="font-mono">COPY</code>/<code class="font-mono">ADD</code> of local files won't work. Use <code class="font-mono">FROM</code>,
				<code class="font-mono">RUN</code>, remote <code class="font-mono">ADD https://…</code>, or <code class="font-mono">RUN git clone</code>. Set
				the container port in the service settings after it's created.
			</p>
		</div>

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
