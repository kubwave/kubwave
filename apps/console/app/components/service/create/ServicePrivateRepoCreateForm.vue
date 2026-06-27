<script setup lang="ts">
import * as z from 'zod';
import { ArrowLeft, ChevronDown, ChevronRight, Copy } from 'lucide-vue-next';
import type { Service, SshKey } from '~/utils/types';
import { isPrivateRepoSshUrl, privateRepoSshUrlMessage } from '~/utils/private-repo-url';

const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ created: [Service]; back: []; done: [] }>();

// Mirrors the API's privateRepoConfigSchema; the repo URL must be SSH (http(s) is the public-repo type).
const schema = z.object({
	name: z.string().trim().min(1, 'Enter a service name.'),
	repoUrl: z.string().trim().min(1, 'Enter a repository URL.').refine(isPrivateRepoSshUrl, privateRepoSshUrlMessage),
	branch: z.string().trim().min(1, 'Enter a branch.'),
	sshKeyId: z.string().uuid('Select a deploy key.'),
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
const { activeTeamId } = useTeamContext();
const { data: sshKeys, isPending: keysLoading } = useTeamSshKeys(activeTeamId);

const { form, isSubmitting, values } = useAppForm({
	schema,
	defaultValues: {
		name: '',
		repoUrl: '',
		branch: 'main',
		sshKeyId: '',
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
				type: 'private-repo',
				config: {
					repoUrl: value.repoUrl,
					branch: value.branch,
					sshKeyId: value.sshKeyId,
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
			rootError.value = serviceCreateError(err);
		}
	}
});

const isDockerfile = computed(() => values.value.builder === 'dockerfile');

const selectedKey = computed<SshKey | null>(() => (sshKeys.value ?? []).find(k => k.id === values.value.sshKeyId) ?? null);
const hasNoKeys = computed(() => !keysLoading.value && (sshKeys.value ?? []).length === 0);

function serviceCreateError(err: unknown): string {
	const code = errorCode(err);
	if (code === 'ssh_key_not_found' || code === 'validation_error')
		return 'Check the repository URL and that the selected deploy key belongs to this team.';
	return serviceErrorMessage(err, 'Could not create service.');
}

async function copyPublicKey() {
	if (!selectedKey.value) return;
	try {
		await navigator.clipboard.writeText(selectedKey.value.publicKey);
		toast.success('Public key copied');
	} catch {
		toast.error('Could not copy', 'Copy the public key manually.');
	}
}
</script>

<template>
	<AppForm :form="form" class="flex flex-col gap-4">
		<Field v-slot="{ componentField }" name="name" label="Name">
			<Input v-bind="componentField" autofocus placeholder="web" :disabled="isSubmitting" />
		</Field>

		<div class="grid gap-4 sm:grid-cols-4">
			<Field v-slot="{ componentField }" name="repoUrl" label="Repository URL" class="sm:col-span-3">
				<Input v-bind="componentField" placeholder="git@github.com:org/repo.git" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
			<Field v-slot="{ componentField }" name="branch" label="Branch" class="sm:col-span-1">
				<Input v-bind="componentField" placeholder="main" class="font-mono text-xs" :disabled="isSubmitting" />
			</Field>
		</div>

		<div class="flex flex-row gap-4">
			<div class="flex flex-1 flex-col gap-4">
				<div class="flex flex-col gap-1">
					<Field v-slot="{ componentField }" name="sshKeyId" label="Deploy key">
						<Select v-bind="componentField" :disabled="isSubmitting || hasNoKeys">
							<SelectTrigger class="w-full">
								<SelectValue :placeholder="keysLoading ? 'Loading deploy keys…' : 'Select a team deploy key'" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem v-for="k in sshKeys ?? []" :key="k.id" :value="k.id">{{ k.name }} · {{ k.keyType }}</SelectItem>
							</SelectContent>
						</Select>
					</Field>
					<p v-if="hasNoKeys" class="text-xs text-muted-foreground">
						This team has no SSH keys yet.
						<NuxtLink to="/team/settings?tab=ssh-keys" class="text-primary">Add a deploy key</NuxtLink>
						first, then return here.
					</p>
				</div>

				<!-- Public key of the selected key: the user must register it as a deploy key on the remote. -->
				<div v-if="selectedKey" class="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs font-medium text-muted-foreground">Add this as a deploy key in your repository</span>
						<Button type="button" size="sm" variant="ghost" :disabled="isSubmitting" @click="copyPublicKey">
							<Copy />
							Copy
						</Button>
					</div>
					<code class="block max-h-24 overflow-auto rounded bg-background p-2 font-mono text-[11px] break-all text-muted-foreground">
						{{ selectedKey.publicKey }}
					</code>
				</div>
			</div>

			<div class="flex flex-1 flex-col gap-4">
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
