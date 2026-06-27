<script setup lang="ts">
import { ChevronDown, ChevronRight, Globe, Plus, X } from 'lucide-vue-next';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

const props = defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
	addDomain: () => void;
	removeDomain: (index: number) => void;
}>();

const advancedOpen = ref(false);

// reka Select hands back a loosely-typed value; keep the union narrow on the draft.
const healthTypeModel = computed<string>({
	get: () => props.state.healthCheck.type,
	set: value => {
		props.state.healthCheck.type = value as 'http' | 'tcp';
	}
});
</script>

<template>
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Health checks</h3>
					<p class="text-xs text-muted-foreground">Kubernetes liveness and readiness probes for the container.</p>
				</div>
				<label class="flex flex-row items-center gap-2">
					<span class="text-xs font-medium text-muted-foreground">Enabled</span>
					<Switch v-model="state.healthCheck.enabled" :disabled="saving" />
				</label>
			</div>
			<div v-if="state.healthCheck.enabled" class="flex flex-col gap-4">
				<div class="grid gap-4 sm:grid-cols-[minmax(8rem,12rem)_1fr_minmax(7rem,10rem)]">
					<ServiceSettingsField name="healthCheck.type" label="Type">
						<Select v-model="healthTypeModel" :disabled="saving">
							<SelectTrigger class="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="http">HTTP</SelectItem>
								<SelectItem value="tcp">TCP</SelectItem>
							</SelectContent>
						</Select>
					</ServiceSettingsField>
					<ServiceSettingsField v-if="state.healthCheck.type === 'http'" name="healthCheck.path" label="Path" class="min-w-0">
						<Input v-model="state.healthCheck.path" placeholder="/health" class="w-full font-mono text-xs" :disabled="saving" />
					</ServiceSettingsField>
					<ServiceSettingsField name="healthCheck.port" label="Port" :class="state.healthCheck.type === 'http' ? undefined : 'sm:col-span-2'">
						<Input
							v-model="state.healthCheck.port"
							inputmode="numeric"
							:placeholder="state.containerPort || '3000'"
							class="w-full"
							:disabled="saving"
						/>
					</ServiceSettingsField>
				</div>

				<div class="flex flex-col gap-3">
					<button
						type="button"
						class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						@click="advancedOpen = !advancedOpen"
					>
						<component :is="advancedOpen ? ChevronDown : ChevronRight" class="size-3.5" />
						Advanced
					</button>
					<div v-if="advancedOpen" class="grid grid-cols-2 gap-4 sm:grid-cols-5">
						<ServiceSettingsField name="healthCheck.initialDelaySeconds" label="Init delay">
							<Input v-model="state.healthCheck.initialDelaySeconds" inputmode="numeric" placeholder="0" class="w-full" :disabled="saving" />
						</ServiceSettingsField>
						<ServiceSettingsField name="healthCheck.periodSeconds" label="Period">
							<Input v-model="state.healthCheck.periodSeconds" inputmode="numeric" placeholder="10" class="w-full" :disabled="saving" />
						</ServiceSettingsField>
						<ServiceSettingsField name="healthCheck.timeoutSeconds" label="Timeout">
							<Input v-model="state.healthCheck.timeoutSeconds" inputmode="numeric" placeholder="3" class="w-full" :disabled="saving" />
						</ServiceSettingsField>
						<ServiceSettingsField name="healthCheck.failureThreshold" label="Failures">
							<Input v-model="state.healthCheck.failureThreshold" inputmode="numeric" placeholder="3" class="w-full" :disabled="saving" />
						</ServiceSettingsField>
						<ServiceSettingsField name="healthCheck.successThreshold" label="Successes">
							<Input v-model="state.healthCheck.successThreshold" inputmode="numeric" placeholder="1" class="w-full" :disabled="saving" />
						</ServiceSettingsField>
					</div>
				</div>
			</div>
			<p v-else class="text-sm text-muted-foreground">Disabled.</p>
		</section>

		<Separator />

		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h3 class="text-sm font-medium">Default domain</h3>
					<p class="text-xs text-muted-foreground">Generate a public platform URL for this service.</p>
				</div>
				<label class="flex flex-row items-center gap-2">
					<span class="text-xs font-medium text-muted-foreground">Public</span>
					<Switch v-model="state.defaultDomainEnabled" :disabled="saving || !state.containerPort.trim()" />
				</label>
			</div>
			<p v-if="!state.containerPort.trim()" class="text-sm text-muted-foreground">Set a container port first.</p>
		</section>

		<Separator />

		<section class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-2">
				<div>
					<h3 class="text-sm font-medium">Domains</h3>
					<p class="text-xs text-muted-foreground">Route external hostnames to a container port.</p>
				</div>
				<Button type="button" variant="ghost" size="sm" @click="addDomain">
					<Plus />
					Add
				</Button>
			</div>
			<p v-if="state.domains.length === 0" class="text-sm text-muted-foreground">No domains.</p>
			<ServiceSettingsField v-for="(item, index) in state.domains" :key="item._id" :name="`domains.${index}.port`">
				<div class="flex items-center gap-2">
					<div class="relative flex-1">
						<Globe class="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input v-model="item.host" placeholder="app.example.com" class="w-full pl-8 font-mono text-xs" :disabled="saving" />
					</div>
					<Input v-model="item.port" inputmode="numeric" placeholder="port" class="w-20 font-mono text-xs" :disabled="saving" />
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="shrink-0 text-muted-foreground hover:text-destructive"
						:disabled="saving"
						@click="removeDomain(index)"
					>
						<X />
					</Button>
				</div>
			</ServiceSettingsField>
		</section>
	</div>
</template>
