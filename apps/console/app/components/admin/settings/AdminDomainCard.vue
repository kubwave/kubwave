<script setup lang="ts">
import { Globe } from 'lucide-vue-next';

type Mode = 'off' | 'wildcard' | 'sslip';

const store = useIntegrationSettings();

const OPTIONS: { value: Mode; label: string; description: string }[] = [
	{
		value: 'sslip',
		label: 'sslip.io (automatic)',
		description: 'Every service gets a working URL derived from the cluster ingress IP — no DNS setup.'
	},
	{
		value: 'wildcard',
		label: 'Wildcard base domain',
		description: 'Use your own domain. Point *.<base> at the cluster ingress, get prettier hosts + TLS.'
	},
	{ value: 'off', label: 'Off', description: 'Services only get the custom domains you add manually.' }
];

// Mirror of the server-side default template + label sanitization, for the live preview only.
function previewLabel(name: string, template: string): string {
	const safe =
		name
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '') || 'app';
	return (template || '{name}-{shortId}').replace('{name}', safe).replace('{shortId}', '1a2b3c4d');
}

const isWildcard = computed(() => store.draft.domain.mode === 'wildcard');
const isSslip = computed(() => store.draft.domain.mode === 'sslip');
</script>

<template>
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Globe class="size-4 text-muted-foreground" />
				App domain
			</CardTitle>
			<CardDescription>
				Every service with an HTTP port gets an auto-generated public URL — unless you add a custom domain, which then takes over.
			</CardDescription>
		</CardHeader>

		<CardContent class="flex flex-col gap-4">
			<SettingRadioCards v-model="store.draft.domain.mode" :options="OPTIONS" />

			<div v-if="isSslip" class="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
				<template v-if="store.sslipBase">
					Services are reachable at
					<code class="font-mono">{{ previewLabel('my-service', store.draft.domain.subdomainTemplate) }}.{{ store.sslipBase }}</code
					>. No DNS configuration required.
				</template>
				<template v-else> Waiting for the cluster ingress IP — services will get a sslip.io URL once the ingress LoadBalancer is ready. </template>
			</div>

			<template v-if="isWildcard">
				<div class="flex flex-col gap-1.5">
					<label for="domain-base" class="text-sm font-medium">Base domain</label>
					<Input id="domain-base" v-model="store.draft.domain.base" placeholder="apps.mycloud.com" :aria-invalid="!store.domainBaseValid" />
					<p v-if="store.domainBaseValid" class="text-xs text-muted-foreground">
						Create a wildcard DNS A record <code class="font-mono">*.{{ store.draft.domain.base.trim() || 'apps.mycloud.com' }}</code> pointing at the
						cluster ingress IP.
					</p>
					<p v-else class="text-xs text-destructive">Enter a base domain for wildcard mode.</p>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="domain-template" class="text-sm font-medium"> Subdomain template <span class="text-muted-foreground">(optional)</span> </label>
					<Input id="domain-template" v-model="store.draft.domain.subdomainTemplate" placeholder="{name}-{shortId}" />
					<p class="text-xs text-muted-foreground">
						Preview:
						<code class="font-mono"
							>{{ previewLabel('my-service', store.draft.domain.subdomainTemplate) }}.{{ store.draft.domain.base.trim() || 'apps.mycloud.com' }}</code
						>
					</p>
				</div>
			</template>
		</CardContent>
	</Card>
</template>
