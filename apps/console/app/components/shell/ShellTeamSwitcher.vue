<script setup lang="ts">
import { Check, ChevronsUpDown, Plus } from 'lucide-vue-next';

const createOpen = ref(false);
const { teams, activeTeam, isPending, suspense } = useTeamContext();
const switchTeam = useSwitchTeam();

// Resolve during SSR so the server renders the dropdown, not the skeleton — a mismatch here
// also offsets every following reka useId(). Swallow errors to degrade to the empty state.
onServerPrefetch(() => suspense().catch(() => {}));

function select(teamId: string) {
	if (teamId !== activeTeam.value?.id) switchTeam.mutate(teamId);
}
</script>

<template>
	<Skeleton v-if="isPending" class="h-9 w-full" />

	<DropdownMenu v-else>
		<DropdownMenuTrigger as-child>
			<button
				type="button"
				class="flex h-9 w-full items-center gap-2 rounded-md border bg-background px-2.5 text-sm shadow-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-primary/35 data-[state=open]:bg-accent"
			>
				<span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-primary" />
				<span class="truncate font-medium">{{ activeTeam?.name ?? 'No team' }}</span>
				<ChevronsUpDown class="ml-auto size-4 shrink-0 text-muted-foreground" />
			</button>
		</DropdownMenuTrigger>

		<DropdownMenuContent align="start" class="w-(--reka-dropdown-menu-trigger-width) min-w-48">
			<DropdownMenuLabel class="text-xs font-normal text-muted-foreground">Teams</DropdownMenuLabel>
			<DropdownMenuItem v-for="team in teams" :key="team.id" @select="select(team.id)">
				<span class="truncate">{{ team.name }}</span>
				<Badge v-if="team.role === 'owner'" size="sm" variant="secondary" class="ml-1">owner</Badge>
				<Check :class="['ml-auto text-primary', team.id === activeTeam?.id ? 'opacity-100' : 'opacity-0']" />
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem @select="createOpen = true">
				<Plus />
				Create team
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>

	<TeamCreateModal v-model:open="createOpen" @created="team => switchTeam.mutate(team.id)" />
</template>
