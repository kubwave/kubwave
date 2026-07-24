<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import { watchPathConfigFields } from '~/utils/repo-watch-paths';

const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ created: [Service]; back: []; done: [] }>();

const schema = z.object({
	name: z.string().trim().min(1, 'Enter a service name.'),
	installationId: z.string().min(1, 'Select a GitHub account.'),
	repoFullName: z.string().min(1, 'Select a repository.'),
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
	watchPaths: z.string().optional(),
	watchEntireRepo: z.boolean(),
	buildCommand: z.string().trim().optional(),
	startCommand: z.string().trim().optional(),
	autoDeploy: z.boolean(),
	description: z.string().optional()
});

const advancedOpen = ref(false);
const rootError = ref<string | null>(null);

const toast = useToast();
const { activeTeamId } = useTeamContext();
const createService = useCreateService(() => props.environmentId);

const { form, isSubmitting, values, setFieldValue } = useAppForm({
	schema,
	defaultValues: {
		name: '',
		installationId: '',
		repoFullName: '',
		branch: 'main',
		builder: 'nixpacks',
		dockerfilePath: '',
		commit: '',
		rootDirectory: '',
		watchPaths: '',
		watchEntireRepo: false,
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
				type: 'github-repo',
				config: {
					installationId: value.installationId,
					repoFullName: value.repoFullName,
					branch: value.branch,
					builder: value.builder,
					...(value.builder === 'dockerfile' && value.dockerfilePath?.trim() ? { dockerfilePath: value.dockerfilePath.trim() } : {}),
					...(value.commit?.trim() ? { commit: value.commit.trim() } : {}),
					...(value.rootDirectory?.trim() ? { rootDirectory: value.rootDirectory.trim() } : {}),
					...watchPathConfigFields(value.watchPaths ?? '', value.watchEntireRepo),
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

const selectedInstallationId = computed(() => values.value.installationId || null);
const isDockerfile = computed(() => values.value.builder === 'dockerfile');
const autoDeployOn = computed(() => values.value.autoDeploy);
const showWatchFields = computed(() => autoDeployOn.value && !values.value.watchEntireRepo);

// Clear the repo picker when the account changes, so a repo chosen under the previous installation isn't submitted with the new one.
watch(selectedInstallationId, () => setFieldValue('repoFullName', ''));

const { data: installations, isPending: installationsPending } = useGitInstallations(activeTeamId);
const { data: repos, isPending: reposPending } = useGitRepos(activeTeamId, selectedInstallationId);
const syncRepos = useSyncGitRepos(activeTeamId, selectedInstallationId);

const noInstallations = computed(() => !installationsPending.value && (installations.value?.length ?? 0) === 0);

function refreshRepos() {
	syncRepos.mutate(undefined, {
		onSuccess: () => toast.success('Repositories refreshed'),
		onError: err => toast.error(serviceErrorMessage(err, 'Could not refresh repositories.'))
	});
}
</script>

<template>
	<div v-if="noInstallations" class="flex flex-col gap-4">
		<div class="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
			No GitHub repositories are available yet. Install the GitHub App on the repositories you want to deploy in
			<NuxtLink to="/team/settings?tab=github" class="font-medium text-foreground underline">team settings → GitHub</NuxtLink>.
		</div>
		<div>
			<Button type="button" variant="ghost" @click="emit('back')">
				<ArrowLeft />
				Back
			</Button>
		</div>
	</div>

	<AppForm v-else :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autofocus placeholder="web" :disabled="isSubmitting" />
		</Field>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field v-slot="{ componentField }" name="installationId" label="Account">
				<Select v-bind="componentField" :disabled="isSubmitting || installationsPending">
					<SelectTrigger class="w-full">
						<SelectValue placeholder="Select an account" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem v-for="inst in installations ?? []" :key="inst.id" :value="inst.id">{{ inst.accountLogin }}</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			<Field v-slot="{ componentField }" name="repoFullName" label="Repository">
				<Select v-bind="componentField" :disabled="isSubmitting || !selectedInstallationId || reposPending">
					<SelectTrigger class="w-full">
						<SelectValue placeholder="Select a repository" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem v-for="repo in repos ?? []" :key="repo.repoFullName" :value="repo.repoFullName">{{ repo.repoFullName }}</SelectItem>
					</SelectContent>
				</Select>
			</Field>
		</div>

		<p v-if="selectedInstallationId" class="-mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
			Just added a repository to the App and don't see it?
			<button
				type="button"
				class="inline-flex items-center gap-1 font-medium text-foreground hover:underline disabled:opacity-50"
				:disabled="isSubmitting || syncRepos.isPending.value"
				@click="refreshRepos"
			>
				<RefreshCw :class="['size-3', syncRepos.isPending.value && 'animate-spin']" />
				{{ syncRepos.isPending.value ? 'Syncing…' : 'Refresh from GitHub' }}
			</button>
		</p>

		<div class="grid gap-4 sm:grid-cols-2">
			<Field v-slot="{ componentField }" name="branch" label="Branch">
				<Input v-bind="componentField" placeholder="main" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
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
			<Field
				v-if="isDockerfile"
				v-slot="{ componentField }"
				name="dockerfilePath"
				label="Dockerfile path"
				description="Relative to the repo root (or root directory)."
			>
				<Input v-bind="componentField" placeholder="Dockerfile" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
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
					<p class="text-xs text-muted-foreground">Redeploy when a new commit lands (via webhook, with polling as a fallback).</p>
				</div>
				<Switch v-bind="componentField" :disabled="isSubmitting" />
			</div>
		</Field>

		<template v-if="autoDeployOn">
			<Field v-slot="{ componentField }" name="watchEntireRepo">
				<div class="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
					<div>
						<p class="text-sm font-medium">Watch entire repository</p>
						<p class="text-xs text-muted-foreground">Ignore the root directory and watch paths; deploy on any commit.</p>
					</div>
					<Switch v-bind="componentField" :disabled="isSubmitting" />
				</div>
			</Field>
			<Field
				v-if="showWatchFields"
				v-slot="{ componentField }"
				name="watchPaths"
				label="Additional watch paths"
				description="One repo-relative path per line. With a root directory set, only those paths (plus the root) trigger auto-deploy."
			>
				<Textarea v-bind="componentField" placeholder="packages/shared" class="min-h-20 font-mono text-xs" :disabled="isSubmitting" />
			</Field>
		</template>

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
