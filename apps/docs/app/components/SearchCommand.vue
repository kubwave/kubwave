<script setup lang="ts">
import { Search } from 'lucide-vue-next';

const open = ref(false);
const { data: sections, execute } = useLazyAsyncData('docs-search-sections', () => queryCollectionSearchSections('docs'), {
	server: false,
	immediate: false
});

const searchSections = computed(() => sections.value ?? []);

watch(open, isOpen => {
	if (isOpen) execute();
});

function onKeydown(event: KeyboardEvent): void {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
		event.preventDefault();
		open.value = true;
	}
}

async function goToResult(destination: string): Promise<void> {
	open.value = false;
	await navigateTo(destination);
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
	<Dialog v-model:open="open">
		<DialogTrigger as-child>
			<Button variant="outline" class="hidden h-9 w-56 justify-start gap-2 bg-background/60 text-muted-foreground hover:bg-accent/50 md:flex">
				<Search class="size-4" />
				<span>Search docs</span>
				<kbd class="ml-auto rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">⌘K</kbd>
			</Button>
		</DialogTrigger>
		<Button variant="ghost" size="icon" class="md:hidden" aria-label="Search docs" @click="open = true">
			<Search class="size-5" />
		</Button>

		<DialogContent class="overflow-hidden p-0 sm:max-w-2xl" :show-close-button="false">
			<DialogTitle class="sr-only">Search documentation</DialogTitle>
			<DialogDescription class="sr-only">Search kubwave documentation and jump to a matching section.</DialogDescription>
			<Command class="border-0">
				<CommandInput placeholder="Search installation, providers, templates…" />
				<CommandList>
					<CommandEmpty>No results found.</CommandEmpty>
					<CommandGroup heading="Documentation">
						<CommandItem
							v-for="section in searchSections"
							:key="section.id"
							:value="`${section.title} ${section.content}`"
							@select="goToResult(section.id)"
						>
							<div class="min-w-0">
								<p class="truncate font-medium">{{ section.title }}</p>
								<p class="line-clamp-1 text-xs text-muted-foreground">{{ section.content }}</p>
							</div>
						</CommandItem>
					</CommandGroup>
				</CommandList>
			</Command>
		</DialogContent>
	</Dialog>
</template>
