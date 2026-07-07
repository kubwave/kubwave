<script setup lang="ts">
import { Check, ChevronsUpDown } from 'lucide-vue-next';

const route = useRoute();
const config = useRuntimeConfig();

type Channel = { id: string; label: string; caption: string; url: string; dot: string };

const channels: Channel[] = [
	{ id: 'latest', label: 'Latest', caption: 'Stable release', url: config.public.latestUrl, dot: 'bg-primary' },
	{ id: 'next', label: 'Next', caption: 'Preview release', url: config.public.nextUrl, dot: 'bg-warning' }
];

const currentId = computed(() => (channels.some(c => c.id === config.public.docsChannel) ? config.public.docsChannel : 'latest'));
const current = computed(() => channels.find(c => c.id === currentId.value) ?? channels[0]!);

// Keep the reader on the same page across channels; the target's 404 page covers pages
// that only exist on one side.
function channelHref(channel: Channel): string {
	return channel.id === currentId.value ? route.fullPath : `${channel.url}${route.fullPath}`;
}
</script>

<template>
	<DropdownMenu>
		<DropdownMenuTrigger as-child>
			<Button variant="outline" size="sm" class="h-8 gap-1.5 px-2.5" aria-label="Switch documentation version">
				<span class="size-1.5 rounded-full" :class="current.dot" />
				<span class="text-xs font-medium">{{ current.label }}</span>
				<ChevronsUpDown class="size-3.5 text-muted-foreground" />
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" class="w-56">
			<DropdownMenuLabel class="text-xs font-normal text-muted-foreground">Documentation version</DropdownMenuLabel>
			<DropdownMenuItem v-for="channel in channels" :key="channel.id" as-child>
				<a :href="channelHref(channel)" class="flex items-center gap-2.5">
					<span class="size-1.5 shrink-0 rounded-full" :class="channel.dot" />
					<span class="flex flex-1 flex-col">
						<span class="text-sm font-medium">{{ channel.label }}</span>
						<span class="text-xs text-muted-foreground">{{ channel.caption }}</span>
					</span>
					<Check v-if="channel.id === currentId" class="size-4 text-primary" />
				</a>
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
</template>
