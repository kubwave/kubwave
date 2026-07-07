<script setup lang="ts">
import { Github, Menu } from 'lucide-vue-next';
import { docsNav } from '~/utils/navigation';
</script>

<template>
	<header class="sticky top-0 z-40 border-b bg-background/78 backdrop-blur-md supports-[backdrop-filter]:bg-background/64">
		<div class="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
			<Sheet>
				<SheetTrigger as-child>
					<Button variant="ghost" size="icon" class="lg:hidden" aria-label="Open navigation">
						<Menu class="size-5" />
					</Button>
				</SheetTrigger>
				<SheetContent side="left" class="w-80 overflow-y-auto p-0">
					<SheetHeader class="border-b px-5 py-4 text-left">
						<SheetTitle>kubwave docs</SheetTitle>
						<SheetDescription>Browse installation, providers, guides, templates, and reference pages.</SheetDescription>
					</SheetHeader>
					<DocsSidebar :groups="docsNav" class="p-5" />
				</SheetContent>
			</Sheet>

			<NuxtLink to="/" class="flex items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
				<img src="/logo.png" alt="kubwave" width="32" height="32" class="size-8 rounded-md" />
				<span class="text-sm font-semibold tracking-tight">kubwave docs</span>
			</NuxtLink>

			<VersionSwitcher />

			<div class="ml-auto flex items-center gap-2">
				<SearchCommand />
				<ThemeToggle />
				<Button variant="ghost" size="icon" as-child>
					<a href="https://github.com/kubwave/kubwave" aria-label="Open kubwave on GitHub" target="_blank" rel="noreferrer">
						<Github class="size-5" />
					</a>
				</Button>
			</div>
		</div>
	</header>
</template>
