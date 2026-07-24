<script setup lang="ts">
import type { SessionUser } from '~/composables/use-auth';

// The full sidebar stack — used both in the desktop rail and inside the mobile Sheet.
// `collapsed` only applies to the desktop rail: icon-only nav, no switcher/labels.
withDefaults(defineProps<{ user: SessionUser | null; isAdmin: boolean; collapsed?: boolean }>(), { collapsed: false });
</script>

<template>
	<div class="flex h-full flex-col">
		<div :class="['flex h-14 items-center', collapsed ? 'justify-center px-0' : 'px-4']">
			<LogoMark v-if="collapsed" />
			<Logo v-else />
		</div>
		<div v-if="!collapsed" class="px-3 pb-3">
			<ShellTeamSwitcher />
		</div>
		<Separator />
		<nav class="flex-1 overflow-y-auto p-3">
			<ShellSidebarNav :is-admin="isAdmin" :collapsed="collapsed" />
		</nav>
		<Separator />
		<div class="p-2">
			<ShellUserMenu v-if="user" :user="user" :collapsed="collapsed" />
		</div>
	</div>
</template>
