<script setup lang="ts">
import { Circle, CircleCheck, Loader2, OctagonX } from 'lucide-vue-next';
import type { TeamDeploymentItem } from '~/composables/use-team-deployments';
import { formatRelative } from '~/utils/format';

// Team-wide deployment feed: latest first, failed runs called out by color.
const props = defineProps<{ items: TeamDeploymentItem[]; pending?: boolean }>();

function statusMeta(status: TeamDeploymentItem['status']) {
	switch (status) {
		case 'succeeded':
			return { icon: CircleCheck, class: 'text-success' };
		case 'failed':
			return { icon: OctagonX, class: 'text-destructive' };
		case 'deploying':
		case 'pending':
		case 'canceling':
			return { icon: Loader2, class: 'text-primary animate-spin' };
		default:
			return { icon: Circle, class: 'text-muted-foreground/60' };
	}
}

const failedCount = computed(() => props.items.filter(item => item.status === 'failed').length);
const rows = computed(() => props.items.map(item => ({ item, meta: statusMeta(item.status) })));
</script>

<template>
	<Card class="gap-0 py-0">
		<CardHeader class="border-b py-4">
			<CardTitle class="flex items-center justify-between text-base">
				Recent activity
				<Badge v-if="failedCount > 0" variant="destructive" size="sm">{{ failedCount }} failed</Badge>
			</CardTitle>
		</CardHeader>

		<CardContent class="p-0">
			<div v-if="pending" class="flex flex-col gap-3 p-4">
				<Skeleton v-for="i in 4" :key="i" class="h-9 rounded-md" />
			</div>

			<EmptyState v-else-if="items.length === 0" variant="inline" title="No deployments yet" description="Deploy a service to see activity here." />

			<ul v-else class="divide-y">
				<li v-for="{ item, meta } in rows" :key="item.id">
					<NuxtLink :to="`/team/projects/${item.projectId}`" class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/60">
						<component :is="meta.icon" :class="['size-4 shrink-0', meta.class]" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{{ item.serviceName }}</p>
							<p class="truncate text-xs text-muted-foreground">{{ item.projectName }} · {{ item.environmentName }}</p>
						</div>
						<span class="shrink-0 text-xs text-muted-subtle">{{ formatRelative(item.createdAt) }}</span>
					</NuxtLink>
				</li>
			</ul>
		</CardContent>
	</Card>
</template>
