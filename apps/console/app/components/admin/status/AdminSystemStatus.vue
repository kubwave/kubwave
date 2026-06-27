<script setup lang="ts">
import { Activity, ArrowUpCircle, CheckCircle2, Cpu, Download, ExternalLink, Package, RefreshCw } from 'lucide-vue-next';
import type { VersionInfo } from '~/composables/use-admin-system';
import { formatRelative, formatUptime } from '~/utils/format';

const confirm = useConfirm();

const { versionInfo, health, updateRuns, check, trigger, invalidateSystemState } = useAdminSystemStatus();

const activeRunId = ref<string | null>(null);
const modalOpen = ref(false);
const autoReload = ref(false);

async function handleTriggerUpdate(version: string) {
	const current = versionInfo.value?.currentVersion;
	const confirmed = await confirm({
		title: 'Update platform',
		description: `Update the platform${current ? ` from ${current}` : ''} to ${version}? The console will be briefly unavailable while the update runs.`,
		confirmLabel: `Update to ${version}`
	});
	if (!confirmed) return;
	trigger.mutate(version, {
		onSuccess: run => {
			activeRunId.value = run.id;
			autoReload.value = true;
			modalOpen.value = true;
		}
	});
}

function handleViewLogs(runId: string) {
	activeRunId.value = runId;
	autoReload.value = false;
	modalOpen.value = true;
}

function handleFinished() {
	invalidateSystemState();
}

const checking = computed(() => check.isPending.value);
const checkError = computed(() => (check.isError.value ? 'Could not check for updates.' : null));

const info = computed<VersionInfo | null>(() => versionInfo.value ?? null);
const hasUpdate = computed(
	() => !!(info.value?.latestVersion && info.value?.currentVersion && info.value.latestVersion !== info.value.currentVersion)
);
const releasesKnown = computed(() => info.value?.availableVersions.length ?? 0);
const latest = computed(() => info.value?.latestVersion ?? null);
const changelogUrl = computed(() =>
	latest.value ? (info.value?.availableVersions.find(r => r.version === latest.value)?.changelogUrl ?? null) : null
);
</script>

<template>
	<div class="flex flex-col gap-6">
		<div class="flex flex-col gap-6">
			<div class="flex justify-end">
				<Button variant="outline" :disabled="checking" class="shrink-0" @click="check.mutate()">
					<RefreshCw :class="checking && 'animate-spin'" />
					Check for updates
				</Button>
			</div>

			<p v-if="checkError" role="alert" class="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive">
				{{ checkError }}
			</p>

			<div class="rounded-xl border p-5 shadow-xs" :class="hasUpdate ? 'border-warning/25 bg-warning/10' : 'border-success/25 bg-success/10'">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div class="flex items-start gap-4">
						<div
							class="flex size-12 shrink-0 items-center justify-center rounded-full"
							:class="hasUpdate ? 'bg-warning/15 text-warning-foreground' : 'bg-success/15 text-success-foreground'"
						>
							<ArrowUpCircle v-if="hasUpdate" class="size-7 animate-pulse" />
							<CheckCircle2 v-else class="size-7" />
						</div>
						<div class="min-w-0">
							<h2 class="text-xl font-semibold tracking-tight">{{ hasUpdate ? 'Update available' : 'You’re up to date' }}</h2>
							<p class="mt-1 text-sm" :class="hasUpdate ? 'text-warning-foreground' : 'text-success-foreground'">
								<template v-if="hasUpdate">
									Version <span class="font-mono">{{ info?.latestVersion }}</span> is ready to install.
								</template>
								<template v-else>Running the latest release.</template>
							</p>
							<p class="mt-2 text-sm text-muted-subtle">
								Current <span class="font-mono text-foreground">{{ info?.currentVersion || 'unknown' }}</span>
							</p>
						</div>
					</div>

					<div v-if="hasUpdate" class="flex shrink-0 items-center gap-2">
						<Button v-if="changelogUrl" as-child variant="ghost">
							<a :href="changelogUrl" target="_blank" rel="noreferrer">
								<ExternalLink />
								Changelog
							</a>
						</Button>
						<Button @click="latest && handleTriggerUpdate(latest)">
							<Download />
							Update to {{ info?.latestVersion }}
						</Button>
					</div>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-xl border bg-card p-4 shadow-xs transition-shadow duration-200 hover:shadow-md">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<Package class="size-4 shrink-0" :class="hasUpdate ? 'text-warning' : 'text-success'" />
						<span class="truncate">Installed version</span>
					</div>
					<p class="mt-3 truncate font-mono text-2xl font-semibold" :title="info?.currentVersion || '—'">{{ info?.currentVersion || '—' }}</p>
					<p class="mt-1 truncate text-xs" :class="hasUpdate ? 'text-warning-foreground' : 'text-muted-subtle'">
						{{ hasUpdate ? `Update to ${info?.latestVersion} available` : 'Latest release' }}
					</p>
				</div>

				<div class="rounded-xl border bg-card p-4 shadow-xs transition-shadow duration-200 hover:shadow-md">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<Activity class="size-4 shrink-0 text-primary" />
						<span class="truncate">Uptime</span>
					</div>
					<p class="mt-3 truncate text-2xl font-semibold" :title="formatUptime(health?.uptime)">{{ formatUptime(health?.uptime) }}</p>
					<p class="mt-1 truncate text-xs text-muted-foreground">API process</p>
				</div>

				<div class="rounded-xl border bg-card p-4 shadow-xs transition-shadow duration-200 hover:shadow-md">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<Cpu class="size-4 shrink-0 text-primary" />
						<span class="truncate">Runtime</span>
					</div>
					<p class="mt-3 truncate font-mono text-2xl font-semibold" :title="health?.node || '—'">{{ health?.node || '—' }}</p>
					<p class="mt-1 truncate text-xs text-muted-foreground">Node compatibility</p>
				</div>

				<div class="rounded-xl border bg-card p-4 shadow-xs transition-shadow duration-200 hover:shadow-md">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<RefreshCw class="size-4 shrink-0 text-muted-foreground" />
						<span class="truncate">Last checked</span>
					</div>
					<p class="mt-3 truncate text-2xl font-semibold" :title="formatRelative(info?.lastCheckedAt, '—')">
						{{ formatRelative(info?.lastCheckedAt, '—') }}
					</p>
					<p class="mt-1 truncate text-xs text-muted-foreground">{{ `${releasesKnown} releases known` }}</p>
				</div>
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			<div class="lg:col-span-2">
				<AdminUpdateRunHistory :update-runs="updateRuns ?? []" @view-logs="handleViewLogs" />
			</div>
			<AdminAvailableReleases :version-info="info" @trigger-update="handleTriggerUpdate" />
		</div>

		<AdminUpdateProgressModal v-model:open="modalOpen" :run-id="activeRunId" :auto-reload-on-success="autoReload" @finished="handleFinished" />
	</div>
</template>
