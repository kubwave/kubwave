<script setup lang="ts">
import { Box } from 'lucide-vue-next';

type Mode = 'platform' | 'external';

const store = useIntegrationSettings();

const OPTIONS: { value: Mode; label: string; description: string }[] = [
	{ value: 'platform', label: 'Platform-managed', description: 'kubwave runs a TLS registry at registry.<console-domain>.' },
	{ value: 'external', label: 'External registry', description: 'Use your own registry endpoint and push credentials.' }
];

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';
const statusMeta = computed<{ label: string; variant: BadgeVariant }>(() => {
	switch (store.registryApplyStatus) {
		case 'applied':
			return { label: 'Applied', variant: 'default' };
		case 'pending':
			return { label: 'Pending', variant: 'secondary' };
		case 'applying':
			return { label: 'Applying', variant: 'secondary' };
		case 'failed':
			return { label: 'Failed', variant: 'destructive' };
		default:
			return { label: 'Not configured', variant: 'secondary' };
	}
});

const isExternal = computed(() => store.draft.registry.mode === 'external');
</script>

<template>
	<Card>
		<CardHeader>
			<div class="flex items-start justify-between gap-3">
				<div>
					<CardTitle class="flex items-center gap-2">
						<Box class="size-4 text-muted-foreground" />
						Build registry
					</CardTitle>
					<CardDescription class="mt-1">Image destination for Dockerfile, public-repo, and private-repo builds.</CardDescription>
				</div>
				<Badge :variant="statusMeta.variant" class="shrink-0">{{ statusMeta.label }}</Badge>
			</div>
		</CardHeader>

		<CardContent class="flex flex-col gap-4">
			<SettingRadioCards v-model="store.draft.registry.mode" :options="OPTIONS" />

			<div
				v-if="store.registryApplyStatus === 'pending' || store.registryApplyStatus === 'applying'"
				class="rounded-lg border px-4 py-3 text-xs text-muted-foreground"
			>
				Registry changes are being applied by the worker.
			</div>
			<div
				v-else-if="store.registryApplyStatus === 'failed'"
				class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
			>
				{{ store.registryLastError || 'Registry apply failed.' }}
			</div>

			<template v-if="isExternal">
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<label for="registry-endpoint" class="text-sm font-medium">Endpoint</label>
						<Input
							id="registry-endpoint"
							v-model="store.draft.registry.endpoint"
							placeholder="registry.example.com/team"
							:disabled="store.isSaving"
							:aria-invalid="!store.registryEndpointValid"
						/>
						<span v-if="!store.registryEndpointValid" class="text-xs text-destructive">Enter a registry host or host/path.</span>
					</div>

					<div class="flex flex-col gap-1.5">
						<label for="registry-username" class="text-sm font-medium">Username</label>
						<Input
							id="registry-username"
							v-model="store.draft.registry.username"
							autocomplete="off"
							:disabled="store.isSaving"
							:aria-invalid="!store.registryUsernameValid"
						/>
						<span v-if="!store.registryUsernameValid" class="text-xs text-destructive">Enter a username.</span>
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<label for="registry-password" class="text-sm font-medium">Password or token</label>
						<Input
							id="registry-password"
							v-model="store.draft.registry.password"
							type="password"
							autocomplete="new-password"
							:placeholder="store.registryHasPassword ? '•••••••• (unchanged)' : ''"
							:disabled="store.isSaving"
							:aria-invalid="!store.registryPasswordValid"
						/>
						<span v-if="!store.registryPasswordValid" class="text-xs text-destructive">Enter a token with push access.</span>
					</div>

					<div class="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
						<div class="flex flex-col gap-0.5">
							<span class="text-sm font-medium">Insecure registry</span>
							<span class="text-xs text-muted-foreground">Use HTTP or skip TLS verification for this endpoint.</span>
						</div>
						<Switch v-model="store.draft.registry.insecure" :disabled="store.isSaving" aria-label="Use insecure registry" />
					</div>
				</div>
			</template>
		</CardContent>
	</Card>
</template>
