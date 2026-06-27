<script setup lang="ts">
import { Download, ExternalLink, PackageCheck } from 'lucide-vue-next';
import type { PlatformVersionGetResponse } from '@kubwave/api-client';
import { formatRelative } from '~/utils/format';
import { isNewerVersion } from '~/utils/versions';

type VersionInfo = PlatformVersionGetResponse;

const props = defineProps<{ versionInfo: VersionInfo | null }>();
const emit = defineEmits<{ triggerUpdate: [version: string] }>();

const releases = computed(() => props.versionInfo?.availableVersions ?? []);
const latest = computed(() => props.versionInfo?.latestVersion ?? null);
const current = computed(() => props.versionInfo?.currentVersion ?? null);
</script>

<template>
	<div class="flex h-96 min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
		<div class="flex flex-row items-center justify-between px-6 py-4">
			<p class="text-base font-semibold">Available releases</p>
			<Badge v-if="releases.length > 0" variant="secondary" class="tabular-nums">{{ releases.length }}</Badge>
		</div>

		<div v-if="releases.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
			<PackageCheck class="size-8 text-muted-foreground" />
			<p class="text-sm text-muted-foreground">You’re on the latest release.</p>
		</div>

		<div v-else class="min-h-0 flex-1 overflow-y-auto">
			<ul class="divide-y divide-border">
				<li v-for="release in releases" :key="release.version" class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="truncate font-mono text-sm font-medium">{{ release.version }}</span>
							<Badge v-if="release.version === latest" size="sm" variant="default">Latest</Badge>
							<Badge v-if="release.version === current" size="sm" variant="secondary">Current</Badge>
						</div>
						<p v-if="release.publishedAt" class="mt-0.5 text-xs text-muted-foreground">{{ formatRelative(release.publishedAt) }}</p>
					</div>

					<div class="flex shrink-0 items-center gap-1">
						<Button v-if="release.changelogUrl" as-child variant="ghost" size="icon" class="size-8 text-muted-foreground">
							<a :href="release.changelogUrl" target="_blank" rel="noreferrer" aria-label="View changelog">
								<ExternalLink />
							</a>
						</Button>
						<Button
							v-if="isNewerVersion(release.version, current)"
							variant="ghost"
							size="sm"
							class="gap-1.5"
							@click="emit('triggerUpdate', release.version)"
						>
							<Download />
							Update
						</Button>
					</div>
				</li>
			</ul>
		</div>
	</div>
</template>
