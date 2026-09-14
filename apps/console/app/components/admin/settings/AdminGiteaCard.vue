<script setup lang="ts">
import { GitFork } from 'lucide-vue-next';

const { connection, connect, disconnect } = useGiteaConnection();
const toast = useToast();

const connected = computed(() => connection.value?.connected ?? false);
const connecting = computed(() => connect.isPending.value);
const disconnecting = computed(() => disconnect.isPending.value);
const formError = computed(() => {
	const err = connect.error.value as { error?: string; details?: unknown; status?: number } | null;
	if (!err) return null;
	const detail = typeof err.details === 'string' ? err.details : null;
	if (err.error === 'gitea_unreachable') {
		return detail ?? 'The API could not reach that Gitea instance. Use a URL reachable from the cluster (not localhost from inside the pod).';
	}
	if (err.error === 'invalid_gitea_url') return 'Enter a valid http(s) instance URL without credentials.';
	return detail ? `${err.error}: ${detail}` : (err.error ?? 'Could not connect Gitea.');
});

const instanceUrl = ref('');
const clientId = ref('');
const clientSecret = ref('');

// Prefer the API-reported URL; fall back to same-origin so the redirect URI is visible even before the query loads.
const callbackUrl = computed(() => {
	if (connection.value?.callbackUrl) return connection.value.callbackUrl;
	if (!import.meta.client) return null;
	return `${window.location.origin}/api/git/gitea/callback`;
});

const webhookUrl = computed(() => {
	if (connection.value?.webhookUrl) return connection.value.webhookUrl;
	if (!import.meta.client) return null;
	return `${window.location.origin}/api/git/gitea/webhook`;
});

const canSubmit = computed(() => Boolean(instanceUrl.value.trim() && clientId.value.trim() && clientSecret.value.trim()));

function submit() {
	if (!canSubmit.value || connecting.value) return;
	connect.mutate({
		instanceUrl: instanceUrl.value.trim(),
		clientId: clientId.value.trim(),
		clientSecret: clientSecret.value.trim()
	});
}

async function copy(value: string | null | undefined) {
	if (!value) return;
	await navigator.clipboard.writeText(value);
	toast.success('Copied');
}
</script>

<template>
	<Card>
		<CardHeader>
			<div class="flex items-start justify-between gap-3">
				<div>
					<CardTitle class="flex items-center gap-2">
						<GitFork class="size-4 text-muted-foreground" />
						Gitea
					</CardTitle>
					<CardDescription class="mt-1">
						Connect a Gitea or Forgejo OAuth application so teams can deploy repositories without SSH keys.
					</CardDescription>
				</div>
				<Badge :variant="connected ? 'default' : 'secondary'" class="shrink-0">{{ connected ? 'Connected' : 'Not connected' }}</Badge>
			</div>
		</CardHeader>

		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm">
				<div class="flex flex-col gap-1.5">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Redirect URI</span>
					<p class="text-xs text-muted-foreground">
						Create an OAuth2 application on Gitea (Settings → Applications) and register this exact URL as the redirect URI.
					</p>
					<div class="flex items-start gap-2">
						<code class="min-w-0 flex-1 break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">{{ callbackUrl ?? 'Loading…' }}</code>
						<Button type="button" variant="outline" size="sm" class="shrink-0" :disabled="!callbackUrl" @click="copy(callbackUrl)">
							Copy
						</Button>
					</div>
				</div>
				<div v-if="webhookUrl" class="flex flex-col gap-1.5 border-t pt-3">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Webhook URL (optional)</span>
					<div class="flex items-start gap-2">
						<code class="min-w-0 flex-1 break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">{{ webhookUrl }}</code>
						<Button type="button" variant="outline" size="sm" class="shrink-0" @click="copy(webhookUrl)">Copy</Button>
					</div>
				</div>
			</div>

			<template v-if="connected">
				<div class="flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm">
					<div>
						<span class="text-muted-foreground">Instance</span>
						<span class="ml-2 font-medium">{{ connection?.instanceUrl }}</span>
					</div>
					<div>
						<span class="text-muted-foreground">Client ID</span>
						<span class="ml-2 font-mono text-xs">{{ connection?.clientId }}</span>
					</div>
				</div>
				<div>
					<Button type="button" variant="destructive" :disabled="disconnecting" @click="disconnect.mutate()">Disconnect</Button>
				</div>
			</template>

			<template v-else>
				<p class="text-sm text-muted-foreground">
					After registering the redirect URI above, paste the instance URL plus the OAuth client ID and secret here.
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5 sm:col-span-2">
						<label class="text-sm font-medium" for="gitea-instance-url">Instance URL</label>
						<Input
							id="gitea-instance-url"
							v-model="instanceUrl"
							placeholder="https://gitea.example"
							autocomplete="off"
							:disabled="connecting"
							@keydown.enter.prevent="submit"
						/>
					</div>
					<div class="flex flex-col gap-1.5">
						<label class="text-sm font-medium" for="gitea-client-id">Client ID</label>
						<Input id="gitea-client-id" v-model="clientId" autocomplete="off" :disabled="connecting" @keydown.enter.prevent="submit" />
					</div>
					<div class="flex flex-col gap-1.5">
						<label class="text-sm font-medium" for="gitea-client-secret">Client secret</label>
						<Input
							id="gitea-client-secret"
							v-model="clientSecret"
							type="password"
							autocomplete="off"
							:disabled="connecting"
							@keydown.enter.prevent="submit"
						/>
					</div>
				</div>
				<p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>
				<div>
					<Button type="button" :disabled="connecting || !canSubmit" @click="submit">
						{{ connecting ? 'Connecting…' : 'Connect Gitea' }}
					</Button>
				</div>
			</template>
		</CardContent>
	</Card>
</template>
