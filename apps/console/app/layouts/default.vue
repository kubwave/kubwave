<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import { Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-vue-next';

// Persistent chrome for the authed app: left rail on desktop, a Sheet drawer on mobile.
const user = useSessionUser();
const isAdmin = computed(() => user.value?.isAdmin ?? false);

const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();

const paletteOpen = ref(false);
useEventListener('keydown', event => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
		event.preventDefault();
		paletteOpen.value = !paletteOpen.value;
	}
});

const navOpen = ref(false);
const route = useRoute();
watch(
	() => route.fullPath,
	() => (navOpen.value = false)
);
</script>

<template>
	<div class="flex min-h-dvh bg-background">
		<aside
			:class="[
				'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-200 ease-out md:flex',
				sidebarCollapsed ? 'w-16' : 'w-60'
			]"
		>
			<ShellNav :user="user" :is-admin="isAdmin" :collapsed="sidebarCollapsed" />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-14 items-center gap-2 border-b bg-background px-4 md:hidden">
				<Sheet v-model:open="navOpen">
					<SheetTrigger as-child>
						<Button variant="ghost" size="icon" aria-label="Open navigation">
							<Menu />
						</Button>
					</SheetTrigger>
					<SheetContent side="left" class="w-72 p-0">
						<SheetHeader class="sr-only">
							<SheetTitle>Navigation</SheetTitle>
						</SheetHeader>
						<ShellNav :user="user" :is-admin="isAdmin" />
					</SheetContent>
				</Sheet>
				<Logo />
			</header>

			<header class="sticky top-0 z-20 hidden h-12 items-center gap-2 border-b bg-background px-4 md:flex">
				<Button
					variant="ghost"
					size="icon"
					class="size-8 text-muted-foreground"
					:title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
					@click="toggleSidebar"
				>
					<PanelLeftOpen v-if="sidebarCollapsed" />
					<PanelLeftClose v-else />
				</Button>
				<button
					type="button"
					class="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
					@click="paletteOpen = true"
				>
					<Search class="size-3.5 shrink-0" />
					<span class="flex-1 truncate text-left">Search or command…</span>
					<kbd class="rounded border bg-background px-1.5 font-sans text-[0.65rem] font-medium text-muted-foreground">⌘K</kbd>
				</button>
			</header>

			<main class="min-w-0 flex-1 bg-muted dark:bg-background">
				<div class="mx-auto w-full max-w-none px-4 py-8 md:px-8 lg:px-10">
					<slot />
				</div>
			</main>
		</div>

		<ShellCommandPalette v-model:open="paletteOpen" />
	</div>
</template>
