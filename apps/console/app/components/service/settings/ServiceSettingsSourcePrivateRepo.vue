<script setup lang="ts">
import { ChevronDown, ChevronRight, Copy, FileCode, Sparkles } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';
import { formatDateTime } from '~/utils/format';

const props = defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
}>();

const toast = useToast();

const sourceIsDockerfile = computed(() => props.state.builder === 'dockerfile');

const { activeTeamId } = useTeamContext();
const { data: sshKeys, isPending: keysLoading } = useTeamSshKeys(activeTeamId);

const keys = computed(() => sshKeys.value ?? []);
const selectedKey = computed(() => keys.value.find(k => k.id === props.state.sshKeyId) ?? null);

const showPublicKey = ref(false);

async function copyPublicKey() {
	if (!selectedKey.value?.publicKey) return;
	try {
		await navigator.clipboard.writeText(selectedKey.value.publicKey);
		toast.success('Public key copied');
	} catch {
		toast.error('Could not copy', 'Copy the public key manually.');
	}
}
</script>

<template>
	<section class="flex flex-col gap-5">
		<div>
			<h3 class="text-sm font-medium">Source</h3>
			<p class="text-xs text-muted-foreground">
				{{
					sourceIsDockerfile
						? 'A private Git repository, cloned over SSH and built from its own Dockerfile.'
						: 'A private Git repository, cloned over SSH and built with Nixpacks.'
				}}
				Redeploy to pick up the latest commit on the branch.
			</p>
		</div>

		<div class="flex flex-col gap-3">
			<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Repository</h4>
			<div class="grid gap-4 sm:grid-cols-6">
				<ServiceSettingsField name="repoUrl" label="Repository URL" class="sm:col-span-4">
					<Input v-model="state.repoUrl" placeholder="git@github.com:org/repo.git" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="branch" label="Branch" class="sm:col-span-1">
					<Input v-model="state.branch" placeholder="main" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="containerPort" label="Container port" class="sm:col-span-1">
					<Input v-model="state.containerPort" inputmode="numeric" placeholder="3000" class="w-full" :disabled="saving" />
				</ServiceSettingsField>
			</div>
		</div>

		<div class="flex flex-col gap-3 rounded-lg border bg-accent/30 p-4">
			<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Authentication</h4>
			<ServiceSettingsField
				name="sshKeyId"
				label="Deploy key"
				description="Cloned over SSH using this key — its public half must be a deploy key on the repository."
			>
				<Select v-model="state.sshKeyId" :disabled="saving">
					<SelectTrigger class="w-full sm:max-w-sm">
						<SelectValue :placeholder="keysLoading ? 'Loading…' : 'Select a team deploy key'" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem v-for="key in keys" :key="key.id" :value="key.id">{{ key.name }} · {{ key.keyType }}</SelectItem>
					</SelectContent>
				</Select>
			</ServiceSettingsField>
			<div v-if="selectedKey" class="flex flex-col gap-2">
				<div class="flex items-center gap-3 text-xs">
					<button
						type="button"
						class="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
						@click="showPublicKey = !showPublicKey"
					>
						<component :is="showPublicKey ? ChevronDown : ChevronRight" class="size-3.5" />
						Public key
					</button>
					<span class="font-mono text-[11px] text-muted-foreground/60">{{ selectedKey.fingerprint }}</span>
					<Button type="button" size="sm" variant="ghost" :disabled="saving" @click="copyPublicKey">
						<Copy />
						Copy
					</Button>
				</div>
				<code
					v-if="showPublicKey"
					class="block max-h-24 overflow-auto rounded bg-background p-2 font-mono text-[11px] break-all text-muted-foreground"
					>{{ selectedKey.publicKey }}</code
				>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Build</h4>
			<Tabs v-model="state.builder" class="w-fit">
				<TabsList>
					<TabsTrigger value="nixpacks" :disabled="saving">
						<Sparkles />
						Nixpacks
					</TabsTrigger>
					<TabsTrigger value="dockerfile" :disabled="saving">
						<FileCode />
						Dockerfile
					</TabsTrigger>
				</TabsList>
			</Tabs>
			<div v-if="sourceIsDockerfile" class="grid gap-4 sm:grid-cols-2">
				<ServiceSettingsField name="dockerfilePath" label="Dockerfile path" description="Relative to the repo root (or root directory).">
					<Input v-model="state.dockerfilePath" placeholder="Dockerfile" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
			</div>
			<div v-else class="grid gap-4 sm:grid-cols-2">
				<ServiceSettingsField name="buildCommand" label="Build command (optional)" description="Overrides Nixpacks' auto-detected build.">
					<Input v-model="state.buildCommand" placeholder="npm run build" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="startCommand" label="Start command (optional)" description="Overrides Nixpacks' auto-detected start.">
					<Input v-model="state.startCommand" placeholder="node dist/server.js" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Advanced</h4>
			<div class="grid gap-4 sm:grid-cols-2">
				<ServiceSettingsField name="commit" label="Commit (optional)" description="Leave blank to track the branch HEAD on each deploy.">
					<Input v-model="state.commit" placeholder="Pin a commit SHA" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="rootDirectory" label="Root directory (optional)" description="Build a sub-path for a monorepo.">
					<Input v-model="state.rootDirectory" placeholder="apps/web" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
			</div>
		</div>
	</section>

	<Separator />
	<section class="flex flex-col gap-3">
		<div class="flex items-start justify-between gap-2">
			<div>
				<h3 class="text-sm font-medium">Auto-deploy</h3>
				<p class="text-xs text-muted-foreground">
					Watch the branch and deploy automatically when a new commit lands. The platform polls the repository — no webhook setup needed.
				</p>
			</div>
			<label class="flex flex-row items-center gap-2">
				<span class="text-xs font-medium text-muted-foreground">Enabled</span>
				<Switch v-model="state.autoDeploy.enabled" :disabled="saving" />
			</label>
		</div>
		<p v-if="!state.autoDeploy.enabled" class="text-sm text-muted-foreground">Disabled — deploy manually or pin a commit above.</p>

		<!-- Read-only poll status the worker writes -->
		<dl
			v-if="state.autoDeploy.enabled && (service.autoDeploy.lastPolledAt || service.autoDeploy.lastPollError)"
			class="flex flex-col gap-1 rounded-md border bg-accent/30 px-3 py-2 text-xs"
		>
			<div v-if="service.autoDeploy.lastPolledAt" class="flex items-center justify-between gap-3">
				<dt class="text-muted-foreground">Last checked</dt>
				<dd>{{ formatDateTime(service.autoDeploy.lastPolledAt, '') }}</dd>
			</div>
			<div v-if="service.autoDeploy.lastPolledCommit" class="flex items-center justify-between gap-3">
				<dt class="text-muted-foreground">Last seen commit</dt>
				<dd class="font-mono">{{ service.autoDeploy.lastPolledCommit.slice(0, 7) }}</dd>
			</div>
			<div v-if="service.autoDeploy.lastPollError" class="flex items-start justify-between gap-3">
				<dt class="shrink-0 text-destructive">Last error</dt>
				<dd class="text-right break-all text-destructive/80">{{ service.autoDeploy.lastPollError }}</dd>
			</div>
		</dl>
	</section>
</template>
