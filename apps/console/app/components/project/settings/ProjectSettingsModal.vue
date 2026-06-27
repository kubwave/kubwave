<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next';
import type { ProjectDetail } from '~/utils/types';

const props = defineProps<{ project: ProjectDetail }>();
const open = defineModel<boolean>('open', { default: false });

const toast = useToast();
const confirm = useConfirm();
const deleteProject = useDeleteProject(() => props.project);

async function onDelete() {
	const confirmed = await confirm({
		title: 'Delete project',
		description: `Delete ${props.project.name}? All of its environments and services are removed.`,
		destructive: true,
		confirmLabel: 'Delete project',
		confirmationText: props.project.name
	});
	if (!confirmed) return;
	try {
		await deleteProject.mutateAsync();
	} catch {
		toast.error('Could not delete project.');
		return;
	}
	toast.success('Project deleted');
	open.value = false;
	await navigateTo('/team/projects');
}
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="sm:max-w-lg">
			<DialogHeader>
				<DialogTitle>Project settings</DialogTitle>
			</DialogHeader>

			<div class="flex flex-col gap-4">
				<ProjectSettingsForm :project="project" @done="open = false" />

				<Separator />
				<ProjectPrPreviewsSection :project="project" />

				<Separator />
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="text-sm font-medium">Delete project</p>
						<p class="text-sm text-muted-foreground">This cannot be undone.</p>
					</div>
					<Button variant="outline" class="text-destructive hover:text-destructive" @click="onDelete">
						<Trash2 />
						Delete
					</Button>
				</div>
			</div>
		</DialogContent>
	</Dialog>
</template>
