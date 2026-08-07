<script setup lang="ts">
import { Lock } from 'lucide-vue-next';
import { Separator } from '~/components/ui/separator';
import { Switch } from '~/components/ui/switch';
import type { Service } from '~/utils/types';
import type { ServiceSettingsValues } from '~/composables/use-service-settings-schema';

defineProps<{
	state: ServiceSettingsValues;
	saving: boolean;
	service: Service;
}>();
</script>

<template>
	<section class="flex flex-col gap-3">
		<div class="flex items-start justify-between gap-2">
			<div>
				<h3 class="text-sm font-medium">Docker</h3>
				<p class="text-xs text-muted-foreground">The container image and the port it listens on.</p>
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-5">
			<ServiceSettingsField name="image" label="Image" class="sm:col-span-3">
				<Input v-model="state.image" class="w-full font-mono text-xs" :disabled="saving" />
			</ServiceSettingsField>
			<ServiceSettingsField name="tag" label="Tag" class="sm:col-span-1">
				<Input v-model="state.tag" class="w-full font-mono text-xs" :disabled="saving" />
			</ServiceSettingsField>
			<ServiceSettingsField name="containerPort" label="Container port">
				<Input v-model="state.containerPort" inputmode="numeric" placeholder="3000" class="w-full" :disabled="saving" />
			</ServiceSettingsField>
		</div>
	</section>

	<Separator />

	<section class="flex flex-col gap-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h3 class="text-sm font-medium">Private registry</h3>
				<p class="text-xs text-muted-foreground">Credentials for pulling this image from a private registry.</p>
			</div>
			<label class="flex flex-row items-center gap-2">
				<span class="text-xs font-medium text-muted-foreground">Enabled</span>
				<Switch v-model="state.registryAuth.enabled" :disabled="saving" />
			</label>
		</div>
		<div v-if="state.registryAuth.enabled" class="flex flex-col gap-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<ServiceSettingsField name="registryAuth.server" label="Registry server">
					<Input v-model="state.registryAuth.server" placeholder="ghcr.io" class="w-full font-mono text-xs" :disabled="saving" />
				</ServiceSettingsField>
				<ServiceSettingsField name="registryAuth.username" label="Username">
					<div class="relative">
						<Lock class="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input v-model="state.registryAuth.username" placeholder="octocat" class="w-full pl-8" :disabled="saving" />
					</div>
				</ServiceSettingsField>
			</div>
			<ServiceSettingsField name="registryAuth.password" label="Password or token">
				<Input
					v-model="state.registryAuth.password"
					type="password"
					:placeholder="state.registryAuth.hasPassword ? '•••••••• (unchanged)' : 'Enter a password'"
					class="w-full font-mono text-xs"
					:disabled="saving"
				/>
			</ServiceSettingsField>
			<p v-if="state.registryAuth.hasPassword" class="text-xs text-muted-foreground">Leave the password field empty to keep the current password.</p>
		</div>
		<p v-else class="text-sm text-muted-foreground">Disabled.</p>
	</section>

	<Separator />

	<section class="flex flex-col gap-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h3 class="text-sm font-medium">Watch for updates</h3>
				<p class="text-xs text-muted-foreground">
					Check this image's tag regularly and deploy automatically when a new release is published — no redeploy needed.
				</p>
			</div>
			<label class="flex flex-row items-center gap-2">
				<span class="text-xs font-medium text-muted-foreground">Enabled</span>
				<Switch v-model="state.imageWatch.enabled" :disabled="saving" />
			</label>
		</div>
		<p v-if="!state.imageWatch.enabled" class="text-sm text-muted-foreground">Disabled — deploy manually.</p>

		<!-- Read-only watch status the worker writes -->
		<dl
			v-if="state.imageWatch.enabled && (service.imageWatch.lastCheckedAt || service.imageWatch.lastError)"
			class="flex flex-col gap-1 rounded-md border bg-accent/30 px-3 py-2 text-xs"
		>
			<div v-if="service.imageWatch.lastCheckedAt" class="flex items-center justify-between gap-3">
				<dt class="text-muted-foreground">Last checked</dt>
				<dd>{{ formatDateTime(service.imageWatch.lastCheckedAt, '') }}</dd>
			</div>
			<div v-if="service.imageWatch.lastDigest" class="flex items-center justify-between gap-3">
				<dt class="text-muted-foreground">Last seen digest</dt>
				<dd class="font-mono">{{ service.imageWatch.lastDigest.slice(0, 12) }}</dd>
			</div>
			<div v-if="service.imageWatch.lastError" class="flex items-start justify-between gap-3">
				<dt class="shrink-0 text-destructive">Last error</dt>
				<dd class="text-right break-all text-destructive/80">{{ service.imageWatch.lastError }}</dd>
			</div>
		</dl>
	</section>
</template>
