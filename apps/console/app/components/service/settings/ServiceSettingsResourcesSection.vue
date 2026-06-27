<script setup lang="ts">
import { HardDrive, Plus, X } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

const props = defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
	addVolume: () => void;
	removeVolume: (index: number) => void;
}>();

const hasVolumes = computed(() => props.state.volumes.length > 0);

// A volume pins the service to one instance, so the toggle reads false when volumes exist.
const autoscalingOn = computed({
	get: () => props.state.autoscaling.enabled && !hasVolumes.value,
	set: value => {
		props.state.autoscaling.enabled = value;
	}
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Resources</h3>
					<p class="text-xs text-muted-foreground">Kubernetes CPU and memory requests and limits. Leave blank for no constraint.</p>
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<ServiceSettingsField name="resources.cpuRequest" label="CPU request">
					<Input v-model="state.resources.cpuRequest" placeholder="250m" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="resources.cpuLimit" label="CPU limit">
					<Input v-model="state.resources.cpuLimit" placeholder="500m" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="resources.memoryRequest" label="Memory request">
					<Input v-model="state.resources.memoryRequest" placeholder="256Mi" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="resources.memoryLimit" label="Memory limit">
					<Input v-model="state.resources.memoryLimit" placeholder="512Mi" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
			</div>
		</section>

		<Separator />

		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Autoscaling</h3>
					<p class="text-xs text-muted-foreground">
						Scale replicas on CPU/memory load with a HorizontalPodAutoscaler. Requires a matching resource request above and a metrics-server in the
						cluster.
					</p>
				</div>
				<label class="flex flex-row items-center gap-2">
					<span class="text-xs font-medium text-muted-foreground">Enabled</span>
					<Switch v-model="autoscalingOn" :disabled="saving || hasVolumes" />
				</label>
			</div>
			<p v-if="hasVolumes" class="text-sm text-muted-foreground">
				Unavailable — this service has a persistent volume, which pins it to a single instance. Scale it vertically with CPU, memory, and volume size
				instead.
			</p>
			<div v-else-if="state.autoscaling.enabled" class="grid gap-4 sm:grid-cols-2">
				<ServiceSettingsField name="autoscaling.minReplicas" label="Min replicas">
					<Input v-model="state.autoscaling.minReplicas" inputmode="numeric" placeholder="1" class="w-full" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="autoscaling.maxReplicas" label="Max replicas">
					<Input v-model="state.autoscaling.maxReplicas" inputmode="numeric" placeholder="3" class="w-full" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="autoscaling.targetCpuUtilizationPercentage" label="Target CPU %">
					<Input v-model="state.autoscaling.targetCpuUtilizationPercentage" inputmode="numeric" placeholder="70" class="w-full" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="autoscaling.targetMemoryUtilizationPercentage" label="Target memory %">
					<Input
						v-model="state.autoscaling.targetMemoryUtilizationPercentage"
						inputmode="numeric"
						placeholder="80"
						class="w-full"
						:disabled="saving"
					/>
				</ServiceSettingsField>
			</div>
			<p v-else class="text-sm text-muted-foreground">Disabled — fixed at 1 replica.</p>
		</section>

		<Separator />

		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Volumes</h3>
					<p class="text-xs text-muted-foreground">
						Persistent storage mounts for the container. A volume pins the service to one instance; resize upward to grow it.
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" :disabled="state.autoscaling.enabled" @click="addVolume">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.autoscaling.enabled" class="text-sm text-muted-foreground">
				Disable autoscaling above to add a volume — the two are mutually exclusive.
			</p>
			<p v-if="state.volumes.length === 0 && !state.autoscaling.enabled" class="text-sm text-muted-foreground">No volumes.</p>
			<!-- Two-row grid per volume so the optional subPath reads as a detail of the mount, not a co-equal field. -->
			<ServiceSettingsField v-for="(item, index) in state.volumes" :key="item._id" :name="`volumes.${index}.size`">
				<!-- min-w-0 lets long paths shrink-and-scroll instead of widening the grid (grid items default to min-width:auto). -->
				<div class="grid grid-cols-[1fr_2fr_5rem_auto] items-center gap-x-2 gap-y-1.5">
					<div class="relative min-w-0">
						<HardDrive class="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input v-model="item.name" placeholder="volume-name" class="w-full pl-8 font-mono text-xs" :disabled="saving" />
					</div>
					<Input v-model="item.mountPath" placeholder="/mount/path" class="w-full min-w-0 font-mono text-xs" :disabled="saving" />
					<Input v-model="item.size" placeholder="1Gi" class="w-full font-mono text-xs" :disabled="saving" />
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="shrink-0 text-muted-foreground hover:text-destructive"
						:disabled="saving"
						@click="removeVolume(index)"
					>
						<X />
					</Button>
					<span
						class="col-start-1 row-start-2 self-center pr-1 text-right text-xs text-muted-foreground"
						title="Mount a subdirectory of the volume instead of its root — for images that initialize into the mount root (e.g. Postgres)."
						>subPath</span
					>
					<Input
						v-model="item.subPath"
						aria-label="Volume subPath"
						placeholder="optional — e.g. pgdata"
						class="col-start-2 row-start-2 w-full min-w-0 font-mono text-xs"
						:disabled="saving"
					/>
				</div>
			</ServiceSettingsField>
		</section>
	</div>
</template>
