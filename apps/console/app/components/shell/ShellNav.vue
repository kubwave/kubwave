<script setup lang="ts">
import type { SessionUser } from '~/composables/use-auth';

// The full sidebar stack — used both in the desktop rail and inside the mobile Sheet.
defineProps<{ user: SessionUser | null; isAdmin: boolean }>();
</script>

<template>
	<div class="flex h-full flex-col">
		<div class="flex h-14 items-center px-4">
			<Logo />
		</div>
		<div class="px-3 pb-3">
			<ShellTeamSwitcher />
		</div>
		<Separator />
		<nav class="flex-1 overflow-y-auto p-3">
			<ShellSidebarNav :is-admin="isAdmin" />
		</nav>
		<Separator />
		<div class="p-2">
			<ShellUserMenu v-if="user" :user="user" />
		</div>
	</div>
</template>
