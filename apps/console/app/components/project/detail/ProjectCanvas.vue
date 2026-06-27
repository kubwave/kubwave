<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { FlowLayoutConflict, removeFlowLayoutNode, saveFlowNodePosition, upsertFlowLayoutNode } from '~/composables/use-flow-layout';
import { queryKeys } from '~/utils/query-keys';
import type { FlowLayout, FlowLayoutNode, FlowNodePosition, Service } from '~/utils/types';

const props = defineProps<{ projectId: string; teamId: string }>();

const api = useApi();
const queryClient = useQueryClient();
const confirm = useConfirm();
const toast = useToast();
const { activeTeamId, isPending: teamPending } = useTeamContext();
const { selectedEnvId } = useSelectedEnv(props.projectId);
const deleteService = useDeleteService(() => selectedEnvId.value ?? '');

const selectedService = ref<Service | null>(null);
const drawerOpen = ref(false);
const createOpen = ref(false);
const dragBaseRevisions = ref<Record<string, number | null | undefined>>({});

const servicesQuery = useEnvironmentServices(selectedEnvId);
const services = computed(() => servicesQuery.data.value ?? []);
const { runtimeById } = useEnvironmentRuntime(selectedEnvId);
const flowLayoutQuery = useEnvironmentFlowLayout(selectedEnvId);
useEnvironmentFlowLayoutSocket(selectedEnvId);

const flowLayoutById = computed<Record<string, FlowLayoutNode | undefined>>(() => {
	const byId: Record<string, FlowLayoutNode | undefined> = {};
	for (const node of flowLayoutQuery.data.value?.nodes ?? []) byId[node.serviceId] = node;
	return byId;
});

watchEffect(() => {
	// Once the team list has resolved, leave any project that isn't in the active team — including when
	// the user has no team at all (activeTeamId null), now reachable since teams can be deleted.
	if (teamPending.value) return;
	if (props.teamId !== activeTeamId.value) void navigateTo(activeTeamId.value ? '/team/projects' : '/');
});

watch(services, () => {
	if (!selectedService.value) return;
	const fresh = services.value.find(service => service.id === selectedService.value!.id) ?? null;
	selectedService.value = fresh;
	if (!fresh) drawerOpen.value = false;
});

const refreshProject = () => void queryClient.invalidateQueries({ queryKey: queryKeys.project(props.projectId) });
const refreshServices = () =>
	selectedEnvId.value && void queryClient.invalidateQueries({ queryKey: queryKeys.environmentServices(selectedEnvId.value) });
const flowLayoutKey = () => queryKeys.environmentFlowLayout(selectedEnvId.value ?? 'none');

function onSelectService(service: Service) {
	selectedService.value = service;
	drawerOpen.value = true;
}

async function onDeleteService(service: Service) {
	const confirmed = await confirm({
		title: 'Delete service',
		description: `Delete ${service.name}? This removes it from the environment.`,
		destructive: true,
		confirmLabel: 'Delete service',
		confirmationText: service.name
	});
	if (!confirmed) return;
	try {
		await deleteService.mutateAsync(service.id);
	} catch {
		toast.error('Could not delete service.');
		return;
	}
	toast.success('Service deleted');
	refreshProject();
}

function setDragBaseRevision(serviceId: string, revision: number | null | undefined) {
	dragBaseRevisions.value = { ...dragBaseRevisions.value, [serviceId]: revision };
}

function popDragBaseRevision(serviceId: string): number | null {
	const revision = dragBaseRevisions.value[serviceId] ?? flowLayoutById.value[serviceId]?.revision ?? null;
	const { [serviceId]: _removed, ...rest } = dragBaseRevisions.value;
	dragBaseRevisions.value = rest;
	return revision;
}

function setFlowLayoutNode(node: FlowLayoutNode) {
	queryClient.setQueryData<FlowLayout>(flowLayoutKey(), current => upsertFlowLayoutNode(current, node));
}

function removeFlowLayoutServiceNode(serviceId: string) {
	queryClient.setQueryData<FlowLayout>(flowLayoutKey(), current => removeFlowLayoutNode(current, serviceId));
}

function onNodeDragStart({ serviceId }: { serviceId: string }) {
	setDragBaseRevision(serviceId, flowLayoutById.value[serviceId]?.revision ?? null);
}

async function onNodePositionChange({ serviceId, position }: { serviceId: string; position: FlowNodePosition }) {
	if (!selectedEnvId.value) return;

	const environmentId = selectedEnvId.value;
	const baseRevision = popDragBaseRevision(serviceId);
	const optimisticNode: FlowLayoutNode = {
		serviceId,
		position,
		revision: baseRevision ?? 0,
		updatedAt: new Date().toISOString()
	};
	setFlowLayoutNode(optimisticNode);

	try {
		const saved = await saveFlowNodePosition(api, environmentId, serviceId, {
			position,
			baseRevision,
			clientMutationId: crypto.randomUUID()
		});
		setFlowLayoutNode(saved);
	} catch (err) {
		if (err instanceof FlowLayoutConflict) {
			if (err.current) setFlowLayoutNode(err.current);
			else removeFlowLayoutServiceNode(serviceId);
			toast.warning('Position changed elsewhere. Latest layout applied.');
			return;
		}
		toast.error('Could not save node position.');
		void flowLayoutQuery.refetch();
	}
}
</script>

<template>
	<ClientOnly v-if="selectedEnvId">
		<ServiceFlowBoard
			:services="services"
			:runtime-by-id="runtimeById"
			:flow-layout-by-id="flowLayoutById"
			:selected-service-id="drawerOpen ? selectedService?.id : null"
			:loading="servicesQuery.isPending.value || flowLayoutQuery.isPending.value"
			@select="onSelectService"
			@create="createOpen = true"
			@delete="onDeleteService"
			@node-drag-start="onNodeDragStart"
			@node-position-change="onNodePositionChange"
		/>
	</ClientOnly>

	<ServiceDetailDrawer
		v-model:open="drawerOpen"
		:service="selectedService"
		:runtime="selectedService ? runtimeById[selectedService.id] : undefined"
		@saved="
			svc => {
				refreshServices();
				selectedService = svc;
			}
		"
		@deleted="
			() => {
				refreshProject();
				selectedService = null;
			}
		"
	/>

	<ServiceCreateModal
		v-if="selectedEnvId"
		v-model:open="createOpen"
		:environment-id="selectedEnvId"
		@created-many="
			created => {
				refreshServices();
				refreshProject();
				if (created[0]) onSelectService(created[0]);
			}
		"
	/>
</template>
