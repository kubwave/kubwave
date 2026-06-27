<script setup lang="ts">
import { LayoutDashboard, FolderKanban, Settings2, Shield } from 'lucide-vue-next';
import type { Component } from 'vue';

interface NavItem {
	to: string;
	label: string;
	icon: Component;
	exact?: boolean;
}

const props = defineProps<{ isAdmin: boolean }>();

const { teams, isPending } = useTeamContext();
// Keep the Team links while loading so users who have teams never see them flash away.
const hasTeams = computed(() => isPending.value || teams.value.length > 0);

const dashboard: NavItem = { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true };
const team: NavItem[] = [
	{ to: '/team/projects', label: 'Projects', icon: FolderKanban },
	{ to: '/team/settings', label: 'Settings', icon: Settings2 }
];
const admin: NavItem[] = [
	{ to: '/admin/users', label: 'Users', icon: Shield },
	{ to: '/admin/settings', label: 'Settings', icon: Settings2 }
];

const groups = computed(() => [
	{ label: null, items: [dashboard] },
	...(hasTeams.value ? [{ label: 'Team', items: team }] : []),
	...(props.isAdmin ? [{ label: 'Admin', items: admin }] : [])
]);

const route = useRoute();
function isActive(item: NavItem): boolean {
	return item.exact ? route.path === item.to : route.path === item.to || route.path.startsWith(`${item.to}/`);
}
</script>

<template>
	<div class="flex flex-col gap-5">
		<div v-for="group in groups" :key="group.label ?? 'main'" class="flex flex-col gap-0.5">
			<p v-if="group.label" class="px-3 pb-1 text-[0.7rem] font-medium tracking-wider text-muted-subtle uppercase">
				{{ group.label }}
			</p>
			<NuxtLink
				v-for="item in group.items"
				:key="item.to"
				:to="item.to"
				:class="[
					'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-[color,background-color] duration-150 ease-out',
					isActive(item) ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
				]"
			>
				<span
					v-if="isActive(item)"
					aria-hidden="true"
					class="absolute top-1/2 left-0 h-4 w-0.5 origin-left -translate-y-1/2 rounded-full bg-primary transition-[opacity,transform] duration-150 ease-out"
				/>
				<component :is="item.icon" :class="['size-4 shrink-0', isActive(item) ? 'text-foreground' : 'text-muted-foreground/80']" />
				{{ item.label }}
			</NuxtLink>
		</div>
	</div>
</template>
