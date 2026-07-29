<script setup lang="ts">
import { Activity, Check, FolderKanban, LayoutDashboard, Monitor, Moon, Settings2, Shield, Sun, Users } from 'lucide-vue-next';

// Global ⌘K/Ctrl+K palette: navigation, team switching and theme — no backend calls of its own.
const open = defineModel<boolean>('open', { default: false });

const router = useRouter();
const colorMode = useColorMode();
const user = useSessionUser();
const { teams, activeTeamId } = useTeamContext();
const switchTeam = useSwitchTeam();

const isAdmin = computed(() => user.value?.isAdmin ?? false);

function run(action: () => void) {
	open.value = false;
	action();
}

const navItems = computed(() => [
	{ to: '/', label: 'Dashboard', icon: LayoutDashboard },
	{ to: '/team/projects', label: 'Projects', icon: FolderKanban },
	{ to: '/team/settings', label: 'Team settings', icon: Settings2 },
	...(isAdmin.value
		? [
				{ to: '/admin/monitoring', label: 'Admin monitoring', icon: Activity },
				{ to: '/admin/users', label: 'Admin users', icon: Shield },
				{ to: '/admin/settings', label: 'Admin settings', icon: Settings2 }
			]
		: [])
]);

const themes = [
	{ value: 'light', label: 'Light theme', icon: Sun },
	{ value: 'dark', label: 'Dark theme', icon: Moon },
	{ value: 'system', label: 'System theme', icon: Monitor }
] as const;
</script>

<template>
	<CommandDialog v-model:open="open">
		<CommandInput placeholder="Type a command or search…" />
		<CommandList>
			<CommandEmpty>No results found.</CommandEmpty>

			<CommandGroup heading="Navigate">
				<CommandItem v-for="item in navItems" :key="item.to" :value="item.label" @select="run(() => router.push(item.to))">
					<component :is="item.icon" />
					{{ item.label }}
				</CommandItem>
			</CommandGroup>

			<template v-if="teams.length > 1">
				<CommandSeparator />
				<CommandGroup heading="Switch team">
					<CommandItem v-for="team in teams" :key="team.id" :value="`Switch to ${team.name}`" @select="run(() => switchTeam.mutate(team.id))">
						<Users />
						{{ team.name }}
						<Check v-if="team.id === activeTeamId" class="ml-auto text-primary" />
					</CommandItem>
				</CommandGroup>
			</template>

			<CommandSeparator />
			<CommandGroup heading="Theme">
				<CommandItem v-for="theme in themes" :key="theme.value" :value="theme.label" @select="run(() => (colorMode.preference = theme.value))">
					<component :is="theme.icon" />
					{{ theme.label }}
				</CommandItem>
			</CommandGroup>
		</CommandList>
	</CommandDialog>
</template>
