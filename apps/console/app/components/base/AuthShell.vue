<script setup lang="ts">
// Shared auth-page scaffold: brand mark + tagline, a card slot, and the self-hosted footer.
defineProps<{ tagline: string }>();
</script>

<template>
	<div class="flex flex-col gap-7">
		<div class="flex animate-in flex-col items-center gap-3 duration-200 ease-out fade-in slide-in-from-bottom-2">
			<LogoMark class="size-9" />
			<p class="text-base text-muted-foreground">{{ tagline }}</p>
		</div>

		<Card class="animate-in py-6 duration-200 ease-out fade-in slide-in-from-bottom-3 [animation-delay:90ms] fill-mode-[backwards]">
			<slot />
		</Card>

		<p class="text-center font-mono text-[0.7rem] tracking-wide text-muted-subtle">SELF-HOSTED · kubwave</p>
	</div>
</template>
