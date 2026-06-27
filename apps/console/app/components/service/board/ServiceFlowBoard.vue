<script setup lang="ts">
import { MarkerType, VueFlow, useVueFlow, type Edge, type NodeDragEvent } from '@vue-flow/core';
import { Background, BackgroundVariant } from '@vue-flow/background';
import '@vue-flow/core/dist/style.css';
import { Container, Crosshair, Loader2, Plus, Trash2 } from 'lucide-vue-next';
import { FLOW_LAYOUT_GRID_SIZE, FLOW_LAYOUT_SNAP_GRID, snapFlowPosition } from '~/composables/use-flow-layout';
import { deriveServiceConnections } from '~/utils/service-connections';
import type { FlowLayoutNode, FlowNodePosition, Service, ServiceRuntime } from '~/utils/types';
import type { ServiceNodeData } from './ServiceNode.vue';

// Rendered CLIENT-ONLY by the consumer (ProjectCanvas) so Vue Flow never touches window/document during SSR.
const props = defineProps<{
	services: Service[];
	runtimeById: Record<string, ServiceRuntime>;
	flowLayoutById: Record<string, FlowLayoutNode | undefined>;
	selectedServiceId?: string | null;
	loading?: boolean;
}>();
const emit = defineEmits<{
	select: [Service];
	create: [];
	delete: [Service];
	nodeDragStart: [{ serviceId: string }];
	nodePositionChange: [{ serviceId: string; position: FlowNodePosition }];
}>();

// This component hosts <VueFlow>, so the store is available here without an explicit provider.
const { fitView } = useVueFlow();

const wrapperRef = ref<HTMLDivElement | null>(null);
const draggingPositions = ref<Record<string, FlowNodePosition | undefined>>({});
const pendingDragReleases = ref<
	Record<
		string,
		| {
				position: FlowNodePosition;
				layoutById: Record<string, FlowLayoutNode | undefined>;
				layoutNode: FlowLayoutNode | undefined;
		  }
		| undefined
	>
>({});

interface MenuState {
	x: number;
	y: number;
	service: Service | null;
}
const menu = ref<MenuState | null>(null);

function onSelect(service: Service) {
	emit('select', service);
}

function fallbackPosition(index: number): FlowNodePosition {
	return snapFlowPosition({ x: (index % 3) * 304, y: Math.floor(index / 3) * 188 });
}

function positionOf(service: Service, index: number): FlowNodePosition {
	const position = draggingPositions.value[service.id] ?? props.flowLayoutById[service.id]?.position ?? fallbackPosition(index);
	return snapFlowPosition(position);
}

const servicePositionById = computed<Record<string, FlowNodePosition>>(() => {
	const byId: Record<string, FlowNodePosition> = {};
	props.services.forEach((service, index) => {
		byId[service.id] = positionOf(service, index);
	});
	return byId;
});

const nodes = computed(() =>
	props.services.map((service, index) => ({
		id: service.id,
		type: 'service',
		position: positionOf(service, index),
		data: {
			service,
			runtime: props.runtimeById[service.id],
			isSelected: service.id === props.selectedServiceId,
			onSelect
		} satisfies ServiceNodeData,
		draggable: true
	}))
);

const edges = computed<Edge[]>(() =>
	deriveServiceConnections(props.services).map(connection => {
		const selected = props.selectedServiceId === connection.sourceServiceId || props.selectedServiceId === connection.targetServiceId;
		const sourcePosition = servicePositionById.value[connection.sourceServiceId];
		const targetPosition = servicePositionById.value[connection.targetServiceId];
		const pointsLeft = sourcePosition && targetPosition ? sourcePosition.x > targetPosition.x : false;
		const color = selected ? 'var(--primary)' : 'color-mix(in oklch, var(--muted-foreground) 72%, transparent)';

		return {
			id: connection.id,
			source: connection.sourceServiceId,
			target: connection.targetServiceId,
			sourceHandle: pointsLeft ? 'source-left' : 'source-right',
			targetHandle: pointsLeft ? 'target-right' : 'target-left',
			type: 'smoothstep',
			selectable: false,
			focusable: false,
			deletable: false,
			updatable: false,
			interactionWidth: 0,
			zIndex: selected ? 2 : 0,
			markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
			style: {
				stroke: color,
				strokeWidth: selected ? 2.25 : 1.5,
				opacity: selected ? 0.95 : 0.62
			},
			data: { envKeys: connection.envKeys }
		};
	})
);

function setDraggingPosition(serviceId: string, position: FlowNodePosition | undefined) {
	if (position) {
		draggingPositions.value = { ...draggingPositions.value, [serviceId]: position };
		return;
	}
	const { [serviceId]: _removed, ...rest } = draggingPositions.value;
	draggingPositions.value = rest;
}

function setPendingDragRelease(serviceId: string, position: FlowNodePosition | undefined) {
	if (position) {
		pendingDragReleases.value = {
			...pendingDragReleases.value,
			[serviceId]: { position, layoutById: props.flowLayoutById, layoutNode: props.flowLayoutById[serviceId] }
		};
		return;
	}
	const { [serviceId]: _removed, ...rest } = pendingDragReleases.value;
	pendingDragReleases.value = rest;
}

function positionsEqual(a: FlowNodePosition, b: FlowNodePosition): boolean {
	return a.x === b.x && a.y === b.y;
}

function settleDraggingPositions() {
	for (const [serviceId, pending] of Object.entries(pendingDragReleases.value)) {
		if (!pending) continue;
		const layoutNode = props.flowLayoutById[serviceId];
		const layoutChanged = props.flowLayoutById !== pending.layoutById;
		const layoutCaughtUp = layoutNode ? positionsEqual(layoutNode.position, pending.position) : false;
		const layoutMovedElsewhere = layoutChanged && (layoutNode !== pending.layoutNode || !layoutNode);
		if (!layoutCaughtUp && !layoutMovedElsewhere) continue;
		setDraggingPosition(serviceId, undefined);
		setPendingDragRelease(serviceId, undefined);
	}
}

watch(() => props.flowLayoutById, settleDraggingPositions, { deep: true });

function nodePosition(event: NodeDragEvent): FlowNodePosition {
	return snapFlowPosition({ x: event.node.position.x, y: event.node.position.y });
}

function onNodeDragStart(event: NodeDragEvent) {
	setDraggingPosition(event.node.id, nodePosition(event));
	emit('nodeDragStart', { serviceId: event.node.id });
}

function onNodeDrag(event: NodeDragEvent) {
	setDraggingPosition(event.node.id, nodePosition(event));
}

function onNodeDragStop(event: NodeDragEvent) {
	const position = nodePosition(event);
	const serviceId = event.node.id;
	setDraggingPosition(serviceId, position);
	setPendingDragRelease(serviceId, position);
	emit('nodePositionChange', { serviceId, position });
	settleDraggingPositions();
}

function openMenu(event: MouseEvent, service: Service | null) {
	event.preventDefault();
	const rect = wrapperRef.value?.getBoundingClientRect();
	menu.value = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0), service };
}
</script>

<template>
	<div ref="wrapperRef" class="relative h-full min-h-128 overflow-hidden rounded-lg border bg-background/20" @click="menu = null">
		<div
			v-if="loading"
			class="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground shadow-sm"
		>
			<Loader2 class="size-3 animate-spin" />
			Loading
		</div>

		<div class="absolute inset-0">
			<VueFlow
				:nodes="nodes"
				:edges="edges"
				:min-zoom="0.4"
				:max-zoom="1.5"
				fit-view-on-init
				:snap-to-grid="true"
				:snap-grid="FLOW_LAYOUT_SNAP_GRID"
				:nodes-connectable="false"
				:edges-updatable="false"
				:edges-focusable="false"
				class="bg-transparent"
				@pane-context-menu="(event: MouseEvent) => openMenu(event, null)"
				@node-context-menu="({ event, node }) => openMenu(event as MouseEvent, (node.data as ServiceNodeData).service)"
				@node-drag-start="onNodeDragStart"
				@node-drag="onNodeDrag"
				@node-drag-stop="onNodeDragStop"
			>
				<template #node-service="nodeProps">
					<ServiceNode :data="nodeProps.data as ServiceNodeData" @select="onSelect" />
				</template>
				<Background :variant="BackgroundVariant.Dots" :gap="FLOW_LAYOUT_GRID_SIZE" :size="1" class="text-foreground/8" />
			</VueFlow>
		</div>

		<div
			v-if="menu"
			class="absolute z-20 min-w-44 overflow-hidden rounded-md border bg-background p-1 text-foreground shadow-md"
			:style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
			@click.stop
		>
			<button
				v-if="menu.service"
				type="button"
				class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 focus:bg-destructive/10"
				@click="
					emit('delete', menu.service);
					menu = null;
				"
			>
				<Trash2 class="size-4" />
				Delete service
			</button>
			<template v-else>
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent focus:bg-accent"
					@click="
						emit('create');
						menu = null;
					"
				>
					<Plus class="size-4" />
					Create service
				</button>
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent focus:bg-accent"
					@click="
						fitView({ duration: 300 });
						menu = null;
					"
				>
					<Crosshair class="size-4" />
					Center view
				</button>
			</template>
		</div>

		<div v-if="!loading && services.length === 0" class="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
			<div>
				<Container class="mx-auto size-9 text-muted-foreground/60" />
				<p class="mt-2 text-sm text-muted-foreground">No services in this environment.</p>
				<p class="mt-1 text-xs text-muted-foreground/70">Right-click the canvas to create one.</p>
			</div>
		</div>
	</div>
</template>
