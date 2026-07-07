<template>
	<div class="relative min-h-[100dvh] text-foreground">
		<div class="docs-backdrop" aria-hidden="true" />
		<a
			class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
			href="#content"
		>
			Skip to content
		</a>
		<AppHeader />
		<slot />
	</div>
</template>
