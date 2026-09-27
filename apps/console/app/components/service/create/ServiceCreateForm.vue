<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft, Lock } from 'lucide-vue-next';
import { Separator } from '~/components/ui/separator';
import { Switch } from '~/components/ui/switch';
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

const schema = z
	.object({
		name: z.string().trim().min(1, 'Enter a service name.'),
		imageRef: z
			.string()
			.trim()
			.min(1, 'Enter an image.')
			.refine(value => parseImageRef(value) !== null, 'Use the form registry/image:tag.'),
		description: z.string().optional(),
		registryEnabled: z.boolean(),
		registryServer: z.string(),
		registryUsername: z.string(),
		registryPassword: z.string(),
		watchEnabled: z.boolean()
	})
	.superRefine((val, ctx) => {
		if (!val.registryEnabled) return;
		if (!val.registryServer.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a registry host, e.g. ghcr.io.', path: ['registryServer'] });
		}
		if (!val.registryUsername.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a username or token.', path: ['registryUsername'] });
		}
		if (!val.registryPassword) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a password or token.', path: ['registryPassword'] });
		}
	});

const rootError = ref<string | null>(null);

const toast = useToast();
const createService = useCreateService(() => props.environmentId);

const { form, isSubmitting, values } = useAppForm({
	schema,
	defaultValues: {
		name: '',
		imageRef: '',
		description: '',
		registryEnabled: false,
		registryServer: '',
		registryUsername: '',
		registryPassword: '',
		watchEnabled: false
	},
	onSubmit: async ({ value }) => {
		const parsed = parseImageRef(value.imageRef);
		if (!parsed) return;
		rootError.value = null;
		try {
			const service = await createService.mutateAsync({
				name: value.name,
				description: value.description ?? '',
				type: 'docker-image',
				config: {
					image: parsed.image,
					tag: parsed.tag,
					containerPort: null,
					env: [],
					domains: [],
					volumes: [],
					...(value.registryEnabled
						? {
								registryAuth: {
									enabled: true,
									server: value.registryServer.trim(),
									username: value.registryUsername.trim(),
									password: value.registryPassword
								}
							}
						: {})
				},
				imageWatch: { enabled: value.watchEnabled }
			});
			emit('created', service);
			toast.success('Service created');
			emit('done');
		} catch (err) {
			rootError.value = serviceErrorMessage(err, 'Could not create service.');
		}
	}
});

// `values` is a Ref at runtime, and templates auto-unwrap refs — reading `.value` there would be undefined, so expose the boolean via a computed.
const registryEnabled = computed(() => values.value.registryEnabled);
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

		<Separator />

		<div class="flex items-start justify-between gap-3">
			<div>
				<h3 class="text-sm font-medium">Private registry</h3>
				<p class="text-xs text-muted-foreground">Add credentials if the image is private. You can change them later.</p>
			</div>
			<Field v-slot="{ componentField }" name="registryEnabled">
				<Switch v-bind="componentField" :disabled="isSubmitting" />
			</Field>
		</div>

		<template v-if="registryEnabled">
			<Field v-slot="{ componentField }" name="registryServer" label="Registry server">
				<Input v-bind="componentField" placeholder="ghcr.io" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
			<Field v-slot="{ componentField }" name="registryUsername" label="Username">
				<div class="relative">
					<Lock class="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input v-bind="componentField" placeholder="octocat" class="pl-8" :disabled="isSubmitting" />
				</div>
			</Field>
			<Field v-slot="{ componentField }" name="registryPassword" label="Password or token">
				<Input v-bind="componentField" type="password" placeholder="Password or token" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
		</template>

		<Field v-slot="{ componentField }" name="watchEnabled">
			<div class="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
				<div>
					<p class="text-sm font-medium">Watch for updates</p>
					<p class="text-xs text-muted-foreground">Deploy automatically when a new release of this tag is published.</p>
				</div>
				<Switch v-bind="componentField" :disabled="isSubmitting" />
			</div>
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
