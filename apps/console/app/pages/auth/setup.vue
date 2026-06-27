<script setup lang="ts">
import type { SaveRegistryInput } from '~/composables/use-admin-registry-settings';

definePageMeta({ layout: 'auth' });

type Step = 'account' | 'registry';
type RegistryMode = 'platform' | 'external';

const api = useApi();
const user = useSessionUser();
const step = ref<Step>(user.value ? 'registry' : 'account');

const registry = useRegistrySettings({ enabled: computed(() => Boolean(user.value)) });

const REGISTRY_OPTIONS: { value: RegistryMode; label: string; description: string }[] = [
	{ value: 'platform', label: 'Platform-managed', description: 'kubwave runs the registry for build artifacts.' },
	{ value: 'external', label: 'External registry', description: 'Use a registry you already operate.' }
];

const registryState = reactive({ mode: 'platform' as RegistryMode, endpoint: '', insecure: false, username: '', password: '' });
const registryPending = ref(false);
const registryError = ref<string | null>(null);

const isExternal = computed(() => registryState.mode === 'external');
const endpointValid = computed(() => !isExternal.value || registryState.endpoint.trim().length > 0);
const usernameValid = computed(() => !isExternal.value || registryState.username.trim().length > 0);
const passwordValid = computed(() => !isExternal.value || registryState.password.length > 0 || registry.settings.value?.hasPassword === true);
const registryValid = computed(() => endpointValid.value && usernameValid.value && passwordValid.value);

watch(
	() => registry.settings.value,
	settings => {
		if (!settings || settings.mode === 'unconfigured') return;
		registryState.mode = settings.mode === 'external' ? 'external' : 'platform';
		registryState.endpoint = settings.mode === 'external' ? (settings.endpoint ?? '') : '';
		registryState.insecure = settings.mode === 'external' ? settings.insecure : false;
		registryState.username = settings.mode === 'external' ? (settings.username ?? '') : '';
	},
	{ immediate: true }
);

onMounted(async () => {
	const status = await $fetch<{ initialized: boolean; registryConfigured: boolean }>('/api/setup/status').catch(() => null);
	if (!status) return;
	if (status.initialized && status.registryConfigured) {
		await navigateTo('/', { replace: true });
		return;
	}
	if (status.initialized) step.value = 'registry';
});

async function onAccountDone() {
	step.value = 'registry';
	await registry.refetch();
}

function registryPayload(): SaveRegistryInput {
	if (registryState.mode === 'platform') return { mode: 'platform' };
	return {
		mode: 'external',
		endpoint: registryState.endpoint.trim(),
		insecure: registryState.insecure,
		username: registryState.username.trim(),
		...(registryState.password ? { password: registryState.password } : {})
	};
}

async function onRegistrySubmit() {
	if (!registryValid.value) return;
	registryPending.value = true;
	registryError.value = null;
	try {
		await registry.save.mutateAsync(registryPayload());
		registryState.password = '';
		await waitForRegistryApply();
	} catch {
		registryError.value = 'Could not save registry settings.';
	} finally {
		registryPending.value = false;
	}
}

async function waitForRegistryApply() {
	for (let attempt = 0; attempt < 160; attempt++) {
		const result = await registry.refetch();
		const settings = result.data;
		if (settings?.applyStatus === 'applied') {
			await navigateTo('/', { replace: true });
			return;
		}
		if (settings?.applyStatus === 'failed') {
			registryError.value = settings.lastError ?? 'Registry apply failed.';
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 3000));
	}
	registryError.value = 'Registry apply is still running. Check Admin Settings for progress.';
}
</script>

<template>
	<AuthShell tagline="Set up your control plane">
		<template v-if="step === 'account'">
			<CardHeader>
				<CardTitle>Create the admin account</CardTitle>
				<CardDescription>This is the first user — they own the platform.</CardDescription>
			</CardHeader>
			<CardContent>
				<SetupForm @done="onAccountDone" />
			</CardContent>
		</template>

		<template v-else>
			<CardHeader>
				<CardTitle>Configure the build registry</CardTitle>
				<CardDescription>This is required before builds can run.</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex flex-col gap-4">
					<SettingRadioCards v-model="registryState.mode" :options="REGISTRY_OPTIONS" />

					<template v-if="isExternal">
						<div class="flex flex-col gap-1.5">
							<Label>Endpoint</Label>
							<Input v-model="registryState.endpoint" placeholder="registry.example.com/team" :disabled="registryPending" />
							<p v-if="!endpointValid" class="text-xs text-destructive">Enter a registry host or host/path.</p>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label>Username</Label>
							<Input v-model="registryState.username" autocomplete="off" :disabled="registryPending" />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label>Password or token</Label>
							<Input v-model="registryState.password" type="password" autocomplete="new-password" :disabled="registryPending" />
						</div>
						<div class="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
							<div class="flex flex-col gap-0.5">
								<span class="text-sm font-medium">Insecure registry</span>
								<span class="text-xs text-muted-foreground">Use HTTP or skip TLS verification for this endpoint.</span>
							</div>
							<Switch v-model="registryState.insecure" :disabled="registryPending" aria-label="Use insecure registry" />
						</div>
					</template>

					<p v-if="registryPending" class="text-sm text-muted-foreground">Applying registry settings. This can take a few minutes.</p>
					<p v-if="registryError" role="alert" class="text-sm text-destructive">{{ registryError }}</p>

					<Button class="mt-1 w-full" :disabled="!registryValid || registryPending" @click="onRegistrySubmit">
						{{ registryPending ? 'Applying…' : 'Save registry' }}
					</Button>
				</div>
			</CardContent>
		</template>
	</AuthShell>
</template>
