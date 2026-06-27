<script setup lang="ts">
import type { Component } from 'vue';
import { ChevronDown, ChevronRight, Container, FileCode2, FileStack, GitBranch, Lock, Sparkles } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import { DATABASE_ENGINES, DATABASE_ENGINE_UI, isDatabaseEngine, type DatabaseEngine } from '~/utils/database-engines';
import type { TemplateListItem } from '~/composables/use-templates';

const { data: templates, isPending: templatesPending } = useTemplates();
const selectedTemplate = ref<TemplateListItem | null>(null);

// Service-type picker hosting the create forms. Contract: prop `environmentId`, emit `createdMany`, v-model:open.
const props = defineProps<{ environmentId: string }>();
const emit = defineEmits<{ createdMany: [Service[]] }>();

const open = defineModel<boolean>('open', { default: false });

type AvailableServiceType = 'docker-image' | 'docker-compose' | 'dockerfile' | 'public-repo' | 'private-repo' | DatabaseEngine;

type TypeOption = {
	id: string;
	name: string;
	description: string;
	icon: Component;
	available?: boolean;
	variants?: { label: string }[];
};

type TypeGroup = { id: string; label: string; options: TypeOption[] };

// Drives the picker. Flip `available` (and wire the config step) to ship a new type.
const TYPE_GROUPS: TypeGroup[] = [
	{
		id: 'docker-based',
		label: 'Docker-based',
		options: [
			{ id: 'docker-image', name: 'Docker Image', description: 'Run an existing container image.', icon: Container, available: true },
			{ id: 'docker-compose', name: 'Docker Compose', description: 'Import a Compose file as services.', icon: FileStack, available: true },
			{ id: 'dockerfile', name: 'Dockerfile', description: 'Build from a Dockerfile.', icon: FileCode2, available: true }
		]
	},
	{
		id: 'from-source',
		label: 'From source',
		options: [
			{
				id: 'private-repo',
				name: 'Private repository',
				description: 'Build & deploy a private Git repo over SSH with Nixpacks — using a team deploy key.',
				icon: Lock,
				available: true
			},
			{
				id: 'public-repo',
				name: 'Public repository',
				description: 'Build & deploy a public Git repo with Nixpacks — no Dockerfile needed.',
				icon: GitBranch,
				available: true
			}
		]
	},
	{
		id: 'databases',
		label: 'Databases',
		// Generated from the engine source of truth so a new managed engine appears here automatically.
		options: DATABASE_ENGINES.map(engine => ({
			id: engine,
			name: DATABASE_ENGINE_UI[engine].label,
			description: DATABASE_ENGINE_UI[engine].description,
			icon: DATABASE_ENGINE_UI[engine].icon,
			available: true
		}))
	}
];

// Split at the option level, not group: a group can mix shipped and upcoming types.
const ACTIVE_GROUPS = TYPE_GROUPS.map(group => ({ ...group, options: group.options.filter(option => option.available) })).filter(
	group => group.options.length > 0
);
const UPCOMING_GROUPS = TYPE_GROUPS.map(group => ({ ...group, options: group.options.filter(option => !option.available) })).filter(
	group => group.options.length > 0
);
const UPCOMING_COUNT = UPCOMING_GROUPS.reduce((sum, group) => sum + group.options.length, 0);

const step = ref<'select' | 'configure'>('select');
const selectedType = ref<AvailableServiceType | null>(null);
const upcomingExpanded = ref(false);

// Reset the flow whenever the modal opens.
watch(open, isOpen => {
	if (isOpen) {
		step.value = 'select';
		selectedType.value = null;
		selectedTemplate.value = null;
		upcomingExpanded.value = false;
	}
});

const selectedOption = computed(() => TYPE_GROUPS.flatMap(group => group.options).find(option => option.id === selectedType.value));
const selectedIcon = computed(() => selectedOption.value?.icon ?? Container);

const title = computed(() => {
	if (step.value === 'select') return 'New service';

	return selectedType.value === 'docker-compose' ? 'Import services' : 'Create service';
});

function selectTemplate(template: TemplateListItem) {
	selectedTemplate.value = template;
	selectedType.value = null;
	step.value = 'configure';
}

function selectOption(option: TypeOption) {
	if (!option.available) return;

	const id = option.id;
	const allowed =
		id === 'docker-image' || id === 'docker-compose' || id === 'dockerfile' || id === 'public-repo' || id === 'private-repo' || isDatabaseEngine(id);
	if (!allowed) return;

	selectedType.value = id as AvailableServiceType;
	step.value = 'configure';
}

function onCreatedMany(services: Service[]) {
	emit('createdMany', services);
}
</script>

<template>
	<Dialog v-model:open="open">
		<DialogContent class="sm:max-w-3xl">
			<DialogHeader>
				<DialogTitle>{{ title }}</DialogTitle>
				<DialogDescription v-if="step === 'select'">Pick how you want to deploy.</DialogDescription>
				<DialogDescription v-else>{{ selectedTemplate?.description ?? selectedOption?.description ?? 'Configure your service.' }}</DialogDescription>
			</DialogHeader>

			<template v-if="step === 'select'">
				<div class="flex max-h-[60vh] flex-col gap-6 overflow-y-auto pr-1">
					<section v-for="group in ACTIVE_GROUPS" :key="group.id" class="flex flex-col gap-3">
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{{ group.label }}</h3>
						<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<button
								v-for="option in group.options"
								:key="option.id"
								type="button"
								class="group relative flex items-start gap-3 rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
								@click="selectOption(option)"
							>
								<span
									class="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground group-hover:text-primary"
								>
									<component :is="option.icon" class="size-5" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col gap-1">
									<span class="text-sm font-medium">{{ option.name }}</span>
									<span class="text-xs text-muted-foreground">{{ option.description }}</span>
								</span>
								<ChevronRight class="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
							</button>
						</div>
					</section>

					<section v-if="templatesPending || (templates && templates.length > 0)" class="flex flex-col gap-3">
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Templates</h3>
						<div v-if="templatesPending" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<Skeleton v-for="i in 2" :key="i" class="h-20 rounded-lg" />
						</div>
						<div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<button
								v-for="template in templates"
								:key="template.id"
								type="button"
								class="group relative flex items-start gap-3 rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
								@click="selectTemplate(template)"
							>
								<span class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
									<img :src="template.logoUrl" :alt="template.name" class="size-6" />
								</span>
								<span class="flex min-w-0 flex-1 flex-col gap-1">
									<span class="text-sm font-medium">{{ template.name }}</span>
									<span class="text-xs text-muted-foreground">{{ template.description }}</span>
								</span>
								<ChevronRight class="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
							</button>
						</div>
					</section>

					<div v-if="UPCOMING_GROUPS.length > 0" class="rounded-lg border border-dashed bg-muted/20">
						<button
							type="button"
							:aria-expanded="upcomingExpanded"
							class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
							@click="upcomingExpanded = !upcomingExpanded"
						>
							<span class="flex items-center gap-1.5">
								<Sparkles class="size-3" />
								{{ UPCOMING_COUNT }} {{ UPCOMING_COUNT === 1 ? 'type' : 'types' }} coming soon
							</span>
							<ChevronDown class="size-3.5 transition-transform" :class="upcomingExpanded && 'rotate-180'" />
						</button>
						<div v-if="upcomingExpanded" class="border-t border-dashed px-3 py-3">
							<div class="flex flex-col gap-5">
								<div v-for="group in UPCOMING_GROUPS" :key="group.id" class="flex flex-col gap-2">
									<div class="flex items-center justify-between">
										<h4 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{{ group.label }}</h4>
										<span class="text-[10px] text-muted-foreground/60">
											{{ group.options.length }} {{ group.options.length === 1 ? 'type' : 'types' }}
										</span>
									</div>
									<ul class="flex flex-col">
										<li v-for="option in group.options" :key="option.id" class="flex flex-col gap-0.5 border-b border-dashed py-2 last:border-b-0">
											<div class="flex items-baseline gap-2">
												<span class="text-sm font-medium">{{ option.name }}</span>
												<span v-if="option.variants" class="text-xs text-muted-foreground/70">
													· {{ option.variants.map(v => v.label).join(' · ') }}
												</span>
											</div>
											<span class="text-xs text-muted-foreground">{{ option.description }}</span>
										</li>
									</ul>
								</div>
							</div>
						</div>
					</div>
				</div>
			</template>

			<template v-else>
				<div class="mb-1 flex items-center gap-2 text-sm font-medium">
					<component :is="selectedIcon" class="size-5 text-primary" />
					<Badge variant="secondary">{{ selectedTemplate?.name ?? selectedOption?.name ?? 'Service' }}</Badge>
				</div>

				<ServiceTemplateCreateForm
					v-if="selectedTemplate"
					:environment-id="props.environmentId"
					:template="selectedTemplate"
					@created="onCreatedMany"
					@back="step = 'select'"
					@done="open = false"
				/>
				<ServiceComposeCreateForm
					v-else-if="selectedType === 'docker-compose'"
					:environment-id="props.environmentId"
					@created="onCreatedMany"
					@back="step = 'select'"
					@done="open = false"
				/>
				<ServiceDockerfileCreateForm
					v-else-if="selectedType === 'dockerfile'"
					:environment-id="props.environmentId"
					@created="service => onCreatedMany([service])"
					@back="step = 'select'"
					@done="open = false"
				/>
				<ServicePublicRepoCreateForm
					v-else-if="selectedType === 'public-repo'"
					:environment-id="props.environmentId"
					@created="service => onCreatedMany([service])"
					@back="step = 'select'"
					@done="open = false"
				/>
				<ServicePrivateRepoCreateForm
					v-else-if="selectedType === 'private-repo'"
					:environment-id="props.environmentId"
					@created="service => onCreatedMany([service])"
					@back="step = 'select'"
					@done="open = false"
				/>
				<ServiceDatabaseCreateForm
					v-else-if="selectedType && isDatabaseEngine(selectedType)"
					:environment-id="props.environmentId"
					:engine="selectedType"
					@created="service => onCreatedMany([service])"
					@back="step = 'select'"
					@done="open = false"
				/>
				<ServiceCreateForm
					v-else
					:environment-id="props.environmentId"
					@created="service => onCreatedMany([service])"
					@back="step = 'select'"
					@done="open = false"
				/>
			</template>
		</DialogContent>
	</Dialog>
</template>
