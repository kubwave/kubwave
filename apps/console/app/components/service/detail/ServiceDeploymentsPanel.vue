<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { Ban, ChevronRight, Loader2, RefreshCw } from 'lucide-vue-next';
import { queryKeys } from '~/utils/query-keys';
import { formatDateTime } from '~/utils/format';
import { canCancelDeployment, deploymentStatusColor, hasBuildStep, isDeploymentBuilding, shouldPollDeploymentLogs } from '~/utils/deployments';
import type { Deployment, DeploymentBuildLogContainer, DeploymentLog } from '~/utils/types';

const props = defineProps<{
	deployments: Deployment[];
	loading?: boolean;
	cancelingDeploymentId?: string;
}>();
const emit = defineEmits<{ cancel: [Deployment] }>();
const api = useApi();

const expanded = ref<string | null>(props.deployments[0]?.id ?? null);
const activeDeployment = computed(() => props.deployments.find(deployment => deployment.id === expanded.value) ?? null);
const activeDeploymentId = computed(() => activeDeployment.value?.id ?? null);

// Map the shared status color to a Badge variant; success gets a green tint, errors the destructive style.
const STATUS_BADGE: Record<ReturnType<typeof deploymentStatusColor>, { variant: 'secondary' | 'destructive'; class: string }> = {
	success: { variant: 'secondary', class: 'border-success/30 bg-success/10 text-success-foreground' },
	error: { variant: 'destructive', class: '' },
	neutral: { variant: 'secondary', class: '' }
};
function statusBadge(status: string) {
	return STATUS_BADGE[deploymentStatusColor(status)];
}

// Default the newest deploy open once a list arrives.
watch(
	() => props.deployments.map(d => d.id).join(','),
	() => {
		if (expanded.value && props.deployments.some(d => d.id === expanded.value)) return;
		expanded.value = props.deployments[0]?.id ?? null;
	}
);

function toggle(id: string) {
	expanded.value = expanded.value === id ? null : id;
}

const {
	data: eventLogsData,
	isPending: eventLogsPending,
	isFetching: eventLogsFetching
} = useQuery({
	queryKey: computed(() => queryKeys.deploymentLogs(activeDeploymentId.value ?? 'none')),
	enabled: computed(() => Boolean(activeDeploymentId.value)),
	refetchInterval: () => (shouldPollDeploymentLogs(activeDeployment.value) ? 2000 : false),
	queryFn: async () => {
		const deploymentId = activeDeploymentId.value;
		if (!deploymentId) return { logs: [] as DeploymentLog[] };
		return apiData(api.deployments(deploymentId).logs.get()).catch(() => {
			throw new Error('Failed to load deployment logs');
		});
	}
});

const { data: buildLogsData, isPending: buildLogsPending } = useQuery({
	queryKey: computed(() => queryKeys.deploymentBuildLogs(activeDeploymentId.value ?? 'none')),
	enabled: computed(() => Boolean(activeDeploymentId.value) && hasBuildStep(activeDeployment.value)),
	refetchInterval: () => (shouldPollDeploymentLogs(activeDeployment.value) && hasBuildStep(activeDeployment.value) ? 2000 : false),
	queryFn: async () => {
		const deploymentId = activeDeploymentId.value;
		if (!deploymentId) return { containers: [] as DeploymentBuildLogContainer[] };
		return apiData(api.deployments(deploymentId).buildLogs.get()).catch(() => {
			throw new Error('Failed to load build logs');
		});
	}
});

const eventLogs = computed(() => eventLogsData.value?.logs ?? []);
const buildContainers = computed(() => buildLogsData.value?.containers.filter(container => container.content.length > 0) ?? []);
</script>

<template>
	<div v-if="loading && deployments.length === 0" class="flex items-center gap-2 py-10 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Loading deployments…
	</div>

	<div v-else-if="deployments.length === 0" class="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
		No deployments yet. Deploy this service to roll its config out.
	</div>

	<ul v-else class="flex flex-col gap-2">
		<li v-for="deployment in deployments" :key="deployment.id" class="overflow-hidden rounded-lg border">
			<div class="flex items-center transition-colors hover:bg-accent/40">
				<button type="button" class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left" @click="toggle(deployment.id)">
					<ChevronRight :class="['size-4 shrink-0 text-muted-foreground transition-transform', expanded === deployment.id && 'rotate-90']" />
					<Badge :variant="statusBadge(deployment.status).variant" :class="statusBadge(deployment.status).class">{{ deployment.status }}</Badge>
					<span v-if="deployment.phase" class="truncate text-sm text-muted-foreground">{{ deployment.phase }}</span>
					<span class="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{{ formatDateTime(deployment.createdAt, '') }}</span>
				</button>
				<Button
					v-if="canCancelDeployment(deployment)"
					type="button"
					variant="ghost"
					size="sm"
					class="mr-2 h-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
					:disabled="cancelingDeploymentId === deployment.id"
					@click="emit('cancel', deployment)"
				>
					<Loader2 v-if="cancelingDeploymentId === deployment.id" class="animate-spin" />
					<Ban v-else />
					Cancel
				</Button>
			</div>
			<div v-if="expanded === deployment.id" class="max-h-136 overflow-x-hidden overflow-y-auto border-t bg-muted/30 px-4 py-3">
				<p v-if="deployment.lastError" class="mb-2 font-mono text-xs wrap-break-word text-destructive">{{ deployment.lastError }}</p>

				<section class="grid gap-2">
					<div class="flex items-center gap-2">
						<h4 class="text-xs font-medium text-foreground">Events</h4>
						<RefreshCw v-if="eventLogsFetching && !eventLogsPending" class="size-3 animate-spin text-muted-foreground" />
					</div>
					<p v-if="eventLogsPending" class="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 class="size-3 animate-spin" />
						Loading events…
					</p>
					<p v-else-if="eventLogs.length === 0" class="text-xs text-muted-foreground">No log entries.</p>
					<ServiceDeploymentTimeline v-else :logs="eventLogs" :deploying="shouldPollDeploymentLogs(deployment)">
						<template v-if="hasBuildStep(deployment)" #build>
							<p v-if="buildLogsPending" class="flex items-center gap-2 text-xs text-muted-foreground">
								<Loader2 class="size-3 animate-spin" />
								Loading build log…
							</p>
							<p v-else-if="buildContainers.length === 0" class="text-xs text-muted-foreground">No build output yet.</p>
							<ServiceBuildLogTerminal v-else :containers="buildContainers" :deployment="deployment" :building="isDeploymentBuilding(deployment)" />
						</template>
					</ServiceDeploymentTimeline>
				</section>
			</div>
		</li>
	</ul>
</template>
