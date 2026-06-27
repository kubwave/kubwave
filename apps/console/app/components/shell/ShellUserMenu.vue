<script setup lang="ts">
import { Check, ChevronsUpDown, LogOut, Monitor, Moon, Sun } from 'lucide-vue-next';
import type { SessionUser } from '~/composables/use-auth';

defineProps<{ user: SessionUser }>();

const { logout } = useAuth();
const colorMode = useColorMode();

// colorMode.preference differs server vs client, so guard the active check against hydration mismatch.
const mounted = ref(false);
onMounted(() => (mounted.value = true));

const themes = [
	{ value: 'light', label: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', icon: Monitor }
] as const;

function selectTheme(event: Event, value: (typeof themes)[number]['value']) {
	event.preventDefault(); // keep the menu open while switching
	colorMode.preference = value;
}
</script>

<template>
	<DropdownMenu>
		<DropdownMenuTrigger as-child>
			<button
				type="button"
				class="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-primary/35 data-[state=open]:bg-accent"
			>
				<UserAvatar :name="user.name" :email="user.email" />
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm leading-tight font-medium">{{ user.name }}</p>
					<p class="truncate text-xs leading-tight text-muted-foreground">{{ user.email }}</p>
				</div>
				<ChevronsUpDown class="size-4 shrink-0 text-muted-foreground" />
			</button>
		</DropdownMenuTrigger>

		<DropdownMenuContent align="end" side="top" :side-offset="8" class="w-60">
			<DropdownMenuLabel class="flex items-center gap-2">
				<UserAvatar :name="user.name" :email="user.email" />
				<div class="min-w-0">
					<p class="truncate text-sm font-medium">{{ user.name }}</p>
					<p class="truncate text-xs font-normal text-muted-foreground">{{ user.email }}</p>
				</div>
			</DropdownMenuLabel>
			<DropdownMenuSeparator />
			<DropdownMenuLabel class="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
			<DropdownMenuItem v-for="theme in themes" :key="theme.value" @select="(event: Event) => selectTheme(event, theme.value)">
				<component :is="theme.icon" />
				{{ theme.label }}
				<Check v-if="mounted && colorMode.preference === theme.value" class="ml-auto text-primary" />
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" @select="logout">
				<LogOut />
				Sign out
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
</template>
