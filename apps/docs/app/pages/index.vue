<script setup lang="ts">
import { ArrowRight, ExternalLink } from 'lucide-vue-next';
import type { DocsHero } from '~/utils/docs-types';

definePageMeta({ layout: 'docs' });

const config = useRuntimeConfig();
const { data: page } = await useAsyncData('docs-home', () => queryCollection('docs').path('/').first());

if (!page.value) {
	throw createError({ statusCode: 404, statusMessage: 'Documentation home not found' });
}

const title = computed(() => page.value?.title ?? 'kubwave');
const description = computed(() => page.value?.description ?? 'kubwave documentation');
const hero = computed<DocsHero>(() => page.value?.hero ?? {});

useSeoMeta({
	title: () => `${title.value} docs`,
	description,
	ogTitle: title,
	ogDescription: description
});

useHead({
	link: [{ rel: 'canonical', href: config.public.latestUrl }]
});
</script>

<template>
	<main id="content" class="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
		<section class="grid items-center gap-12 py-16 lg:grid-cols-[minmax(0,1fr)_26rem] lg:py-24">
			<div class="space-y-7">
				<span class="hero-badge">
					<span class="inline-block size-2 rounded-full bg-green-500 ring-2 ring-green-500/30" />
					Open-source · Kubernetes-native
				</span>
				<div class="space-y-5">
					<h1 class="text-gradient max-w-3xl text-5xl font-bold tracking-tight text-balance md:text-6xl">
						{{ page?.title }}
					</h1>
					<p class="max-w-xl text-lg leading-8 text-muted-foreground md:text-xl">
						{{ hero.tagline ?? page?.description }}
					</p>
				</div>
				<div class="flex flex-wrap gap-3">
					<Button
						v-for="action in hero.actions"
						:key="action.link"
						:variant="action.variant === 'primary' ? 'default' : 'outline'"
						size="lg"
						as-child
					>
						<NuxtLink :to="action.link" class="gap-2">
							{{ action.text }}
							<ArrowRight v-if="action.icon === 'right-arrow'" class="size-4" />
							<ExternalLink v-else-if="action.icon === 'external'" class="size-4" />
						</NuxtLink>
					</Button>
				</div>
			</div>

			<div class="glow-primary lg:justify-self-end">
				<TerminalInstall />
			</div>
		</section>

		<ContentRenderer v-if="page" :value="page" class="docs-prose docs-landing" />
	</main>
</template>

<style scoped>
/* Landing keeps section headings flush-left and full width — no reading-column clamp. */
.docs-landing :deep(h2) {
	margin-top: 4rem;
}
.docs-landing :deep(h2:first-child) {
	margin-top: 0;
}
</style>
