<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { Container, Network } from 'lucide-vue-next';
import type { Service, ServiceRuntime } from '~/utils/types';
import type { RuntimeStatus } from '~/components/base/RuntimeBadge.vue';
import { DATABASE_ENGINE_UI, isDatabaseEngine } from '~/utils/database-engines';

// Custom Vue Flow node. Vue Flow passes the node's `data` object through the slot props.
export interface ServiceNodeData {
	service: Service;
	runtime?: ServiceRuntime;
	isSelected: boolean;
	onSelect: (service: Service) => void;
}

const props = defineProps<{ data: ServiceNodeData }>();
const emit = defineEmits<{ select: [Service] }>();

const service = computed(() => props.data.service);
const runtime = computed(() => props.data.runtime);
const isDatabase = computed(() => isDatabaseEngine(service.value.type));
const image = computed(() => {
	const config = service.value.config;
	if ('version' in config) return `${DATABASE_ENGINE_UI[service.value.type as keyof typeof DATABASE_ENGINE_UI].label} ${config.version}`;
	if ('image' in config) return `${config.image}:${config.tag}`;
	if ('repoUrl' in config) return config.repoUrl;
	return 'Built from Dockerfile';
});
const typeLabel = computed(() => {
	if (isDatabase.value) return DATABASE_ENGINE_UI[service.value.type as keyof typeof DATABASE_ENGINE_UI].label;
	if (service.value.type === 'dockerfile') return 'Dockerfile';
	if (service.value.type === 'public-repo') return 'Git';
	if (service.value.type === 'private-repo') return 'Git (SSH)';
	return 'Docker';
});
// Datastores use the database icon as a subtle signal rather than a colour change.
const nodeIcon = computed(() => (isDatabase.value ? DATABASE_ENGINE_UI[service.value.type as keyof typeof DATABASE_ENGINE_UI].icon : Container));
</script>

<template>
	<div
		:class="[
			'group/node relative w-64 cursor-pointer rounded-lg border bg-background p-3 text-left shadow-sm transition hover:shadow-md',
			data.isSelected ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
		]"
		@click="emit('select', service)"
	>
		<Handle
			id="target-left"
			type="target"
			:position="Position.Left"
			:connectable="false"
			class="pointer-events-none !size-2 !border-0 !bg-transparent opacity-0"
		/>
		<Handle
			id="target-right"
			type="target"
			:position="Position.Right"
			:connectable="false"
			class="pointer-events-none !size-2 !border-0 !bg-transparent opacity-0"
		/>
		<Handle
			id="source-left"
			type="source"
			:position="Position.Left"
			:connectable="false"
			class="pointer-events-none !size-2 !border-0 !bg-transparent opacity-0"
		/>
		<Handle
			id="source-right"
			type="source"
			:position="Position.Right"
			:connectable="false"
			class="pointer-events-none !size-2 !border-0 !bg-transparent opacity-0"
		/>

		<div class="flex items-start gap-3">
			<span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/15">
				<component :is="nodeIcon" class="size-5" />
			</span>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<h3 class="truncate text-sm font-semibold">{{ service.name }}</h3>
					<Badge variant="secondary">{{ typeLabel }}</Badge>
				</div>
				<p class="mt-1 truncate font-mono text-xs text-muted-foreground">{{ image }}</p>
				<RuntimeBadge
					:status="(runtime?.status ?? 'unknown') as RuntimeStatus"
					:ready-replicas="runtime?.readyReplicas"
					:desired-replicas="runtime?.desiredReplicas"
					class="mt-2"
				/>
				<div class="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
					<Network class="size-3.5" />
					<span>{{ service.config.containerPort ? `:${service.config.containerPort}` : 'No port' }}</span>
					<span class="text-muted-foreground/40">·</span>
					<span>{{ service.config.env.length }} vars</span>
				</div>
			</div>
		</div>
	</div>
</template>
