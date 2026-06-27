<script setup lang="ts">
import { Save } from 'lucide-vue-next';
import type { ProjectDetail } from '~/utils/types';

const props = defineProps<{ project: ProjectDetail }>();

const toast = useToast();
const updatePrPreviews = useUpdateProjectPrPreviews(() => props.project);

// Single base per project: at most one persistent env carries prPreviewsEnabled.
const persistentEnvironments = computed(() => props.project.environments.filter(env => env.kind === 'persistent'));
const activeBase = computed(() => persistentEnvironments.value.find(env => env.prPreviewsEnabled) ?? null);

const enabled = ref(false);
const selectedEnvId = ref<string | undefined>(undefined);

// Seed once from the project's current base; the 10s project poll (refetchInterval) must not clobber unsaved toggle/selection edits.
let seeded = false;
watch(
	[activeBase, persistentEnvironments],
	([base, envs]) => {
		if (seeded) return;
		enabled.value = Boolean(base);
		selectedEnvId.value = base?.id ?? envs[0]?.id;
		seeded = true;
	},
	{ immediate: true }
);

// The base we'd persist given the current toggle/selection (undefined = no base).
const desiredTarget = computed(() => (enabled.value ? selectedEnvId.value : undefined));
const currentTarget = computed(() => activeBase.value?.id);
const dirty = computed(() => desiredTarget.value !== currentTarget.value);

async function onSave() {
	try {
		await updatePrPreviews.mutateAsync(desiredTarget.value ?? null);
		toast.success('PR previews updated');
	} catch {
		toast.error('Could not update PR previews.');
	}
}

const pending = computed(() => updatePrPreviews.isPending.value);
</script>

<template>
	<div class="flex flex-col gap-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<p class="text-sm font-medium">PR Previews</p>
				<p class="text-sm text-muted-foreground">
					Clone the selected environment for every open pull request on its repo-backed services, and tear it down when the PR closes.
				</p>
			</div>
			<Switch v-model="enabled" :disabled="pending || persistentEnvironments.length === 0" />
		</div>

		<div class="flex items-end justify-between gap-3">
			<Select v-model="selectedEnvId" :disabled="!enabled || pending || persistentEnvironments.length === 0">
				<SelectTrigger class="w-56">
					<SelectValue placeholder="Select an environment" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem v-for="env in persistentEnvironments" :key="env.id" :value="env.id">{{ env.name }}</SelectItem>
				</SelectContent>
			</Select>
			<Button type="button" :disabled="pending || !dirty" @click="onSave">
				<Save v-if="!pending" />
				Save
			</Button>
		</div>
	</div>
</template>
