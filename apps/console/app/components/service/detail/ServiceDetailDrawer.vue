<script setup lang="ts">
import { Ban, Container, Rocket } from 'lucide-vue-next';
import { canCancelDeployment } from '~/utils/deployments';
import type { Deployment, Service, ServiceRuntime } from '~/utils/types';
import type { RuntimeStatus } from '~/components/base/RuntimeBadge.vue';

// Contract (consumed by the service board): props `service`/`runtime`, emits `saved(service)`/`deleted()`, `v-model:open`.
const props = defineProps<{ service: Service | null; runtime?: ServiceRuntime }>();
const emit = defineEmits<{ saved: [Service]; deleted: [] }>();
const open = defineModel<boolean>('open', { default: false });

const confirm = useConfirm();

const serviceId = computed(() => props.service?.id);
const environmentId = computed(() => props.service?.environmentId);
const { deployments, latestDeployment, activeDeployment, isLoading, deploy, cancelDeployment } = useServiceDeployments(serviceId, environmentId);

const TABS = [
	{ key: 'overview', label: 'Overview' },
	{ key: 'metrics', label: 'Metrics' },
	{ key: 'logs', label: 'Logs' },
	{ key: 'deployments', label: 'Deployments' },
	{ key: 'settings', label: 'Settings' }
] as const;
type TabKey = (typeof TABS)[number]['key'];

const tab = ref<TabKey>('overview');

// Reset to Overview whenever a (different) service opens.
watch([() => props.service?.id, open], () => {
	if (props.service && open.value) tab.value = 'overview';
});

async function onCancelDeployment(deployment: Deployment) {
	const confirmed = await confirm({
		title: 'Cancel deployment',
		description: 'Cancel this deployment and restore the previous successful version.',
		destructive: true,
		confirmLabel: 'Cancel deployment'
	});
	if (!confirmed) return;
	cancelDeployment.mutate(deployment.id);
}

function onSaved(updated: Service) {
	emit('saved', updated);
}

// SettingsForm owns the confirm/delete/toast; the drawer just closes and bubbles `deleted()`.
function onDeleted() {
	emit('deleted');
	open.value = false;
}

const imageLabel = computed(() => {
	const config = props.service?.config;
	if (!config) return '';
	return 'image' in config ? `${config.image}:${config.tag}` : 'Built from Dockerfile';
});
</script>

<template>
	<Sheet v-model:open="open">
		<SheetContent side="right" class="w-full max-w-none gap-0 p-0 sm:max-w-none lg:max-w-[70rem]">
			<SheetHeader v-if="service" class="flex w-full flex-row items-start gap-3 border-b p-4">
				<span class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/15">
					<Container class="size-5" />
				</span>
				<div class="min-w-0 flex-1">
					<SheetTitle class="truncate font-semibold">{{ service.name }}</SheetTitle>
					<p class="truncate font-mono text-xs text-muted-foreground">{{ imageLabel }}</p>
					<RuntimeBadge
						:status="(runtime?.status ?? 'unknown') as RuntimeStatus"
						:ready-replicas="runtime?.readyReplicas"
						:desired-replicas="runtime?.desiredReplicas"
						class="mt-1.5"
					/>
				</div>
				<div class="mr-8 flex items-center justify-end gap-2">
					<Button
						v-if="activeDeployment && canCancelDeployment(activeDeployment)"
						type="button"
						variant="outline"
						size="sm"
						class="text-destructive hover:bg-destructive/10 hover:text-destructive"
						:disabled="cancelDeployment.isPending.value"
						@click="onCancelDeployment(activeDeployment)"
					>
						<Ban v-if="!cancelDeployment.isPending.value" />
						Cancel
					</Button>
					<Button size="sm" :disabled="deploy.isPending.value" @click="deploy.mutate()">
						<Rocket v-if="!deploy.isPending.value" />
						Deploy
					</Button>
				</div>
			</SheetHeader>

			<div v-if="service" class="flex min-h-0 flex-1 flex-col">
				<Tabs v-model="tab" class="px-4 pt-3">
					<TabsList class="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
						<TabsTrigger
							v-for="t in TABS"
							:key="t.key"
							:value="t.key"
							class="h-auto flex-none rounded-none border-b-2 border-transparent bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:outline-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent"
						>
							{{ t.label }}
						</TabsTrigger>
					</TabsList>
				</Tabs>

				<div v-show="tab === 'overview'" class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
					<ServiceOverviewTab :service="service" :runtime="runtime" :latest-deployment="latestDeployment" />
				</div>

				<div v-show="tab === 'metrics'" class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
					<ServiceMetricsTab :service="service" :active="tab === 'metrics'" />
				</div>

				<!-- Logs (kept mounted while open so the buffer survives tab switches) -->
				<div v-show="tab === 'logs'" class="flex min-h-0 flex-1 flex-col px-4 py-3">
					<ServiceLogsTab :service="service" :active="tab === 'logs'" />
				</div>

				<div v-show="tab === 'deployments'" class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
					<ServiceDeploymentsPanel
						:deployments="deployments"
						:loading="isLoading"
						:canceling-deployment-id="cancelDeployment.isPending.value ? cancelDeployment.variables.value : undefined"
						@cancel="onCancelDeployment"
					/>
				</div>

				<div v-show="tab === 'settings'" class="flex min-h-0 flex-1 flex-col">
					<ServiceSettingsForm :key="service.id" :service="service" @saved="onSaved" @deleted="onDeleted" />
				</div>
			</div>
		</SheetContent>
	</Sheet>
</template>
