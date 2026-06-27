<script setup lang="ts">
import { FolderKanban } from 'lucide-vue-next';
import type { ProjectListItem } from '~/composables/use-project-data';
import { formatRelative } from '~/utils/format';

// One project card for both the dashboard "recent" grid (compact) and the full projects grid.
defineProps<{ project: ProjectListItem; compact?: boolean }>();
</script>

<template>
	<NuxtLink :to="`/team/projects/${project.id}`" class="group block">
		<div
			class="flex h-full flex-col rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow] duration-150 ease-out group-hover:border-primary/30 group-hover:shadow-sm"
			:class="compact ? 'p-4' : 'p-5'"
		>
			<div class="flex items-start" :class="compact ? 'gap-3' : 'gap-4'">
				<div
					class="flex shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground/70"
					:class="compact ? 'size-9 rounded-lg' : 'size-11'"
				>
					<FolderKanban class="size-5" />
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="truncate font-semibold" :class="compact ? 'text-sm' : 'text-base'">{{ project.name }}</h3>
					<p class="mt-0.5 truncate text-xs text-muted-foreground">{{ project.description || 'No description' }}</p>
				</div>
			</div>
			<div class="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
				<span>
					<span class="font-semibold text-foreground tabular-nums">{{ project.environmentCount }}</span> env{{
						project.environmentCount !== 1 ? 's' : ''
					}}
				</span>
				<span>
					<span class="font-semibold text-foreground tabular-nums">{{ project.serviceCount }}</span> svc{{ project.serviceCount !== 1 ? 's' : '' }}
				</span>
				<span class="ml-auto text-muted-subtle">{{ formatRelative(project.updatedAt) }}</span>
			</div>
		</div>
	</NuxtLink>
</template>
