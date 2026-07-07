<script setup lang="ts">
import type { TocLink } from '~/utils/docs-types';
import { docsNav, getDocsPager, normalizeDocsPath } from '~/utils/navigation';

definePageMeta({ layout: 'docs', key: route => route.path });

const route = useRoute();
const config = useRuntimeConfig();
const path = computed(() => normalizeDocsPath(route.path));

const { data: page } = await useAsyncData(`docs-page-${path.value}`, () => queryCollection('docs').path(path.value).first());

if (!page.value) {
	throw createError({ statusCode: 404, statusMessage: 'Documentation page not found' });
}

const title = computed(() => page.value?.title ?? 'kubwave docs');
const description = computed(() => page.value?.description ?? 'kubwave documentation');
const pager = computed(() => getDocsPager(path.value));
const tocLinks = computed<readonly TocLink[]>(() => page.value?.body?.toc?.links ?? []);

useSeoMeta({
	title,
	description,
	ogTitle: title,
	ogDescription: description
});

useHead({
	link: [{ rel: 'canonical', href: computed(() => `${config.public.latestUrl}${path.value}`) }]
});
</script>

<template>
	<div class="mx-auto grid max-w-[88rem] gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[16rem_minmax(0,54rem)_15rem] lg:px-8">
		<aside class="hidden lg:block">
			<div class="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-4">
				<DocsSidebar :groups="docsNav" />
			</div>
		</aside>

		<main id="content" class="min-w-0">
			<header class="mb-10 space-y-4">
				<Badge variant="secondary" class="w-fit">Documentation</Badge>
				<h1 class="text-4xl font-bold tracking-tight text-balance">{{ page?.title }}</h1>
				<p class="max-w-2xl text-lg leading-8 text-muted-foreground">{{ page?.description }}</p>
			</header>
			<ContentRenderer v-if="page" :value="page" class="docs-prose" />
			<DocsPager :pager="pager" />
		</main>

		<aside class="hidden xl:block">
			<div class="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto">
				<DocsToc :links="tocLinks" />
			</div>
		</aside>
	</div>
</template>
