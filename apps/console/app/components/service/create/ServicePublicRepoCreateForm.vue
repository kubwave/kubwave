<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-vue-next';
import type { Service } from '~/utils/types';

const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ created: [Service]; back: []; done: [] }>();

// Mirrors the API's publicRepoConfigSchema; only repo + branch are required, the rest is tuned in settings after creation.
const schema = z.object({
	name: z.string().trim().min(1, 'Enter a service name.'),
	repoUrl: z
		.string()
		.trim()
		.min(1, 'Enter a repository URL.')
		.regex(/^https?:\/\/\S+$/i, 'Enter a public http(s) Git URL.'),
	branch: z.string().trim().min(1, 'Enter a branch.'),
	builder: z.enum(['nixpacks', 'dockerfile']),
	dockerfilePath: z.string().trim().optional(),
	commit: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{7,64}$/, 'Enter a valid commit SHA.')
		.or(z.literal(''))
		.optional(),
	rootDirectory: z.string().trim().optional(),
	buildCommand: z.string().trim().optional(),
	startCommand: z.string().trim().optional(),
	// Poll the branch and redeploy on a new commit; interval defaults to 60s, tunable in settings.
	autoDeploy: z.boolean(),
	description: z.string().optional()
});

const advancedOpen = ref(false);
const rootError = ref<string | null>(null);

const toast = useToast();
const createService = useCreateService(() => props.environmentId);

const { form, isSubmitting, values } = useAppForm({
	schema,
	defaultValues: {
		name: '',
		repoUrl: '',
		branch: 'main',
		builder: 'nixpacks',
		dockerfilePath: '',
		commit: '',
		rootDirectory: '',
		buildCommand: '',
		startCommand: '',
		autoDeploy: false,
		description: ''
	},
	onSubmit: async ({ value }) => {
		rootError.value = null;
		try {
			const service = await createService.mutateAsync({
				name: value.name,
				description: value.description ?? '',
				type: 'public-repo',
				config: {
					repoUrl: value.repoUrl,
					branch: value.branch,
					builder: value.builder,
					...(value.builder === 'dockerfile' && value.dockerfilePath?.trim() ? { dockerfilePath: value.dockerfilePath.trim() } : {}),
					...(value.commit?.trim() ? { commit: value.commit.trim() } : {}),
					...(value.rootDirectory?.trim() ? { rootDirectory: value.rootDirectory.trim() } : {}),
					...(value.builder !== 'dockerfile' && value.buildCommand?.trim() ? { buildCommand: value.buildCommand.trim() } : {}),
					...(value.builder !== 'dockerfile' && value.startCommand?.trim() ? { startCommand: value.startCommand.trim() } : {}),
					containerPort: null,
					env: [],
					domains: [],
					volumes: []
				},
				autoDeploy: { enabled: value.autoDeploy }
			});
			emit('created', service);
			toast.success('Service created');
			emit('done');
		} catch (err) {
			rootError.value = serviceErrorMessage(err, 'Could not create service.');
		}
	}
});

const isDockerfile = computed(() => values.value.builder === 'dockerfile');
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autofocus placeholder="web" :disabled="isSubmitting" />
		</Field>

		<div class="grid gap-4 sm:grid-cols-4">
			<Field v-slot="{ componentField }" name="repoUrl" label="Repository URL" class="sm:col-span-3">
				<Input v-bind="componentField" placeholder="https://github.com/user/repo" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
			<Field v-slot="{ componentField }" name="branch" label="Branch" class="sm:col-span-1">
				<Input v-bind="componentField" placeholder="main" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field v-slot="{ componentField }" name="builder" label="Build method">
				<Select v-bind="componentField" :disabled="isSubmitting">
					<SelectTrigger class="w-full">
						<SelectValue placeholder="Select a build method" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="nixpacks">Nixpacks (auto-detect)</SelectItem>
						<SelectItem value="dockerfile">Dockerfile</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			<Field
				v-if="isDockerfile"
				v-slot="{ componentField }"
				name="dockerfilePath"
				label="Dockerfile path"
				description="Relative to the repo root (or root directory)."
			>
				<Input v-bind="componentField" placeholder="Dockerfile" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
		</div>

		<button
			type="button"
			class="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			@click="advancedOpen = !advancedOpen"
		>
			<component :is="advancedOpen ? ChevronDown : ChevronRight" class="size-3.5" />
			Advanced
		</button>
		<div v-if="advancedOpen" class="grid gap-4 sm:grid-cols-2">
			<Field v-slot="{ componentField }" name="commit" label="Commit" description="Leave blank to track the branch HEAD.">
				<Input v-bind="componentField" placeholder="Pin a commit SHA" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
			<Field v-slot="{ componentField }" name="rootDirectory" label="Root directory" description="Build a sub-path for a monorepo.">
				<Input v-bind="componentField" placeholder="apps/web" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
			<Field v-if="!isDockerfile" v-slot="{ componentField }" name="buildCommand" label="Build command">
				<Input v-bind="componentField" placeholder="npm run build" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
			<Field v-if="!isDockerfile" v-slot="{ componentField }" name="startCommand" label="Start command">
				<Input v-bind="componentField" placeholder="node dist/server.js" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
		</div>

		<Field v-slot="{ componentField }" name="autoDeploy">
			<div class="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
				<div>
					<p class="text-sm font-medium">Auto-deploy on push</p>
					<p class="text-xs text-muted-foreground">Poll the branch and redeploy when a new commit lands.</p>
				</div>
				<Switch v-bind="componentField" :disabled="isSubmitting" />
			</div>
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
