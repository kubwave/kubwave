<script setup lang="ts">
import type { FunctionalComponent } from 'vue';
import { ChartLine, Database, HardDrive, Loader2, Package, TrendingUp } from 'lucide-vue-next';
import { formatBytes, formatRelative, percentOf } from '~/utils/format';

const store = useScalingSettings();

const LABELS: Record<string, { title: string; icon: FunctionalComponent }> = {
	postgres: { title: 'Platform database', icon: Database },
	registry: { title: 'Container registry', icon: Package },
	prometheus: { title: 'Managed Prometheus', icon: ChartLine }
};

const hasPrometheusVolume = computed(() => store.volumes?.volumes.some(vol => vol.volume === 'prometheus') ?? false);
const visibleVolumes = computed(() => store.volumes?.volumes.filter(vol => store.showRegistryStorage || vol.volume !== 'registry') ?? []);
const capGridClass = computed(() => {
	const count = 1 + (store.showRegistryStorage ? 1 : 0) + (hasPrometheusVolume.value ? 1 : 0);
	if (count >= 3) return 'md:grid-cols-3';
	if (count === 2) return 'sm:grid-cols-2';
	return '';
});

// Gentle severity tint — muted by default, warns as a volume approaches full.
function barClass(pct: number | null): string {
	if (pct == null) return 'bg-muted';
	if (pct >= 90) return 'bg-destructive/70';
	if (pct >= 75) return 'bg-warning/70';
	return 'bg-primary/60';
}
</script>

<template>
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<HardDrive class="size-4 text-muted-foreground" />
				Storage
			</CardTitle>
			<CardDescription>Live fill of platform-managed volumes and how they grow automatically.</CardDescription>
		</CardHeader>

		<CardContent class="flex flex-col gap-5">
			<div v-if="store.volumesLoading && !store.volumes" class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
				<Loader2 class="size-4 animate-spin" />
				Loading usage…
			</div>

			<div v-else-if="store.volumes" class="flex flex-col gap-4">
				<div v-for="vol in visibleVolumes" :key="vol.volume" class="flex flex-col gap-1.5">
					<div class="flex items-center justify-between gap-3 text-sm">
						<span class="flex items-center gap-1.5 font-medium">
							<component :is="LABELS[vol.volume]?.icon ?? HardDrive" class="size-4 text-muted-foreground" />
							{{ LABELS[vol.volume]?.title ?? vol.volume }}
						</span>
						<span v-if="vol.available" class="tabular-nums text-muted-foreground">
							{{ formatBytes(vol.usedBytes) }} / {{ formatBytes(vol.capacityBytes) }}
							<span v-if="percentOf(vol.usedBytes, vol.capacityBytes) != null" class="ml-1 font-medium text-foreground">
								({{ Math.round(percentOf(vol.usedBytes, vol.capacityBytes) ?? 0) }}%)
							</span>
						</span>
						<span v-else class="text-xs text-muted-foreground">No usage data</span>
					</div>

					<div class="relative h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full transition-[width]"
							:class="barClass(vol.available ? percentOf(vol.usedBytes, vol.capacityBytes) : null)"
							:style="{ width: `${(vol.available ? percentOf(vol.usedBytes, vol.capacityBytes) : 0) ?? 0}%` }"
						/>
						<!-- Autoscaling trigger line: where the worker grows the volume -->
						<div
							v-if="store.draft.autoscaling.enabled && vol.available"
							class="absolute inset-y-0 w-0.5 bg-foreground/50"
							:style="{ left: `${store.draft.autoscaling.thresholdPercent}%` }"
							:title="`Grows automatically past ${store.draft.autoscaling.thresholdPercent}%`"
						/>
					</div>

					<p v-if="vol.capBytes != null" class="text-xs text-muted-foreground">Grows up to {{ formatBytes(vol.capBytes) }}</p>
					<p v-if="vol.available && vol.sampledAt" class="text-xs text-muted-foreground">{{ formatRelative(vol.sampledAt) }}</p>
				</div>
			</div>

			<p v-else class="py-2 text-sm text-muted-foreground">Volume usage is unavailable right now.</p>

			<Separator />

			<div class="flex items-start justify-between gap-4">
				<div class="flex items-start gap-3">
					<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<TrendingUp class="size-5" />
					</span>
					<div class="flex flex-col gap-0.5">
						<span class="text-sm font-medium">Volume autoscaling</span>
						<span class="text-xs text-muted-foreground">
							When a volume crosses the usage threshold, the worker grows it by the step — up to its cap, at most once per hour. Needs a storage class
							that supports online expansion.
						</span>
					</div>
				</div>
				<Switch v-model="store.draft.autoscaling.enabled" aria-label="Enable volume autoscaling" />
			</div>

			<div class="flex flex-col gap-3 transition-opacity" :class="{ 'pointer-events-none opacity-50': !store.draft.autoscaling.enabled }">
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<label for="vas-threshold" class="text-sm font-medium">Usage threshold (%)</label>
						<Input id="vas-threshold" v-model.number="store.draft.autoscaling.thresholdPercent" type="number" :min="50" :max="95" />
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="vas-growth" class="text-sm font-medium">Growth step (%)</label>
						<Input id="vas-growth" v-model.number="store.draft.autoscaling.growthPercent" type="number" :min="10" :max="100" />
					</div>
				</div>
				<div class="grid gap-4" :class="capGridClass">
					<div class="flex flex-col gap-1.5">
						<label for="vas-cap-postgres" class="text-sm font-medium">Database cap</label>
						<Input id="vas-cap-postgres" v-model="store.draft.autoscaling.postgresCap" placeholder="100Gi" />
					</div>
					<div v-if="store.showRegistryStorage" class="flex flex-col gap-1.5">
						<label for="vas-cap-registry" class="text-sm font-medium">Registry cap</label>
						<Input id="vas-cap-registry" v-model="store.draft.autoscaling.registryCap" placeholder="200Gi" />
					</div>
					<div v-if="hasPrometheusVolume" class="flex flex-col gap-1.5">
						<label for="vas-cap-prometheus" class="text-sm font-medium">Prometheus cap</label>
						<Input id="vas-cap-prometheus" v-model="store.draft.autoscaling.prometheusCap" placeholder="50Gi" />
					</div>
				</div>
				<p v-if="!store.capsValid" class="text-xs text-destructive">Caps must be whole-Gi values of at least 10Gi, like "100Gi".</p>
				<p v-if="!store.percentsValid" class="text-xs text-destructive">Threshold must be 50–95%, growth 10–100%.</p>
			</div>
		</CardContent>
	</Card>
</template>
