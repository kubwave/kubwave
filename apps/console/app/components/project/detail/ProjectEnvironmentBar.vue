<script setup lang="ts">
import { GitPullRequest, Pencil, Plus, Trash2 } from 'lucide-vue-next';
import type { Environment, ProjectDetail } from '~/utils/types';

const props = defineProps<{ project: ProjectDetail }>();

const confirm = useConfirm();
const toast = useToast();

const { selectedEnvId, setSelectedEnvId } = useSelectedEnv(props.project.id);

// Live project (server-prefetched) so env mutations that invalidate queryKeys.project update the tab strip.
const { data: project } = useProjectDetail(() => props.project.id, { initialData: () => props.project });
const deleteEnvironment = useDeleteEnvironment(() => props.project.id);

const environments = computed(() => project.value?.environments ?? []);

// Split persistent envs from worker-created preview envs. Previews sit after a separator, are selectable but not renamable/deletable.
const persistentEnvironments = computed(() => environments.value.filter(env => env.kind === 'persistent'));
const previewEnvironments = computed(() => environments.value.filter(env => env.kind === 'preview'));

// Reconcile a stale selected-env id (useState persists across the SPA session); only write when it differs to avoid a loop.
watchEffect(() => {
	const envs = environments.value;
	if (envs.length === 0) return;
	const current = selectedEnvId.value;
	const valid = current != null && envs.some(env => env.id === current);
	if (!valid) {
		setSelectedEnvId(envs[0]?.id ?? null);
	}
});

const envModalOpen = ref(false);
const envModalTarget = ref<Environment | null>(null);

const activeEnv = computed(() => environments.value.find(env => env.id === selectedEnvId.value) ?? environments.value[0] ?? null);

function openCreate() {
	envModalTarget.value = null;
	envModalOpen.value = true;
}
function openRename() {
	envModalTarget.value = activeEnv.value;
	envModalOpen.value = true;
}

async function onDeleteEnvironment() {
	if (!activeEnv.value || activeEnv.value.kind === 'preview' || persistentEnvironments.value.length <= 1) return;
	const env = activeEnv.value;
	const confirmed = await confirm({
		title: 'Delete environment',
		description: `Delete ${env.name}? Services in this environment are removed.`,
		destructive: true,
		confirmLabel: 'Delete environment',
		confirmationText: env.name
	});
	if (!confirmed) return;
	const nextId = environments.value.find(e => e.id !== env.id)?.id ?? null;
	try {
		await deleteEnvironment.mutateAsync(env.id);
	} catch {
		toast.error('Could not delete environment.');
		return;
	}
	toast.success('Environment deleted');
	setSelectedEnvId(nextId);
}

function onSaved(env: Environment) {
	setSelectedEnvId(env.id);
}

// Shared active/inactive styling for both the persistent and preview env tabs.
function envTabState(env: Environment) {
	return env.id === activeEnv.value?.id ? 'border-primary text-primary-text' : 'border-transparent text-muted-foreground hover:text-foreground';
}
</script>

<template>
	<div class="mt-4 flex items-center gap-2 border-b">
		<div role="tablist" class="flex min-w-0 flex-1 items-center justify-start overflow-x-auto">
			<button
				v-for="env in persistentEnvironments"
				:key="env.id"
				type="button"
				:class="['relative shrink-0 rounded-none border-b-2 px-3 py-2 text-sm font-medium transition-colors', envTabState(env)]"
				@click="setSelectedEnvId(env.id)"
			>
				{{ env.name }}
				<Badge v-if="env.serviceCount > 0" size="sm" variant="secondary" class="ml-1.5 tabular-nums">{{ env.serviceCount }}</Badge>
			</button>

			<Button variant="ghost" size="icon" class="size-8" aria-label="Add environment" title="Add environment" @click="openCreate">
				<Plus />
			</Button>

			<template v-if="previewEnvironments.length">
				<div class="mx-1.5 h-5 shrink-0 self-center border-l" aria-hidden="true" />
				<button
					v-for="env in previewEnvironments"
					:key="env.id"
					type="button"
					:title="env.prRepoUrl ?? undefined"
					:class="[
						'relative flex shrink-0 items-center gap-1.5 rounded-none border-b-2 px-3 py-2 text-sm font-medium transition-colors',
						envTabState(env)
					]"
					@click="setSelectedEnvId(env.id)"
				>
					<GitPullRequest class="size-3.5 shrink-0" />
					PR #{{ env.prNumber }}
					<Badge v-if="env.serviceCount > 0" size="sm" variant="secondary" class="ml-0.5 tabular-nums">{{ env.serviceCount }}</Badge>
				</button>
			</template>
		</div>

		<div class="flex shrink-0 flex-wrap gap-1.5">
			<Button variant="ghost" size="sm" :disabled="!activeEnv || activeEnv?.kind === 'preview'" @click="openRename">
				<Pencil />
				Rename
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="text-muted-foreground hover:text-destructive"
				:disabled="!activeEnv || activeEnv?.kind === 'preview' || persistentEnvironments.length <= 1"
				@click="onDeleteEnvironment"
			>
				<Trash2 />
				Delete
			</Button>
		</div>
	</div>

	<EnvironmentModal v-model:open="envModalOpen" :project-id="props.project.id" :environment="envModalTarget" @saved="onSaved" />
</template>
