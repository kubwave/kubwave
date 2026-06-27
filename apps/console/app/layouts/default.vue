<script setup lang="ts">
import { Menu } from 'lucide-vue-next';

// Persistent chrome for the authed app: left rail on desktop, a Sheet drawer on mobile.
const user = useSessionUser();
const isAdmin = computed(() => user.value?.isAdmin ?? false);

const navOpen = ref(false);
const route = useRoute();
watch(
	() => route.fullPath,
	() => (navOpen.value = false)
);
</script>

<template>
	<div class="flex min-h-dvh bg-background">
		<aside class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-muted/30 md:flex">
			<ShellNav :user="user" :is-admin="isAdmin" />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex h-14 items-center gap-2 border-b px-4 md:hidden">
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

			<main class="min-w-0 flex-1">
				<div class="mx-auto w-full max-w-none px-4 py-8 md:px-8 lg:px-10">
					<slot />
				</div>
			</main>
		</div>
	</div>
</template>
