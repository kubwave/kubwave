<script setup lang="ts">
import { Github } from 'lucide-vue-next';

const { connection, connect, disconnect } = useGithubConnection();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const connected = computed(() => connection.value?.connected ?? false);
const connecting = computed(() => connect.isPending.value);
const disconnecting = computed(() => disconnect.isPending.value);

function openInstall() {
	if (connection.value?.installUrl) window.open(connection.value.installUrl, '_blank', 'noopener');
}

// Surface the status the manifest callback redirects back with (installing repos happens per-team in team settings).
onMounted(async () => {
	const q = route.query;
	if (typeof q.git_error === 'string') toast.error('GitHub connection failed', q.git_error);
	else if (q.connected === '1') toast.success('GitHub App connected', 'Teams can now install it on their repositories.');
	if (q.git_error || q.connected) await router.replace({ query: {} });
});
</script>

<template>
	<Card>
		<CardHeader>
			<div class="flex items-start justify-between gap-3">
				<div>
					<CardTitle class="flex items-center gap-2">
						<Github class="size-4 text-muted-foreground" />
						GitHub
					</CardTitle>
					<CardDescription class="mt-1">Connect a GitHub App to deploy private repositories and auto-deploy on push.</CardDescription>
				</div>
				<Badge :variant="connected ? 'default' : 'secondary'" class="shrink-0">{{ connected ? 'Connected' : 'Not connected' }}</Badge>
			</div>
		</CardHeader>

		<CardContent class="flex flex-col gap-4">
			<template v-if="connected">
				<div class="rounded-lg border px-4 py-3 text-sm">
					<span class="text-muted-foreground">App</span>
					<span class="ml-2 font-medium">{{ connection?.appSlug }}</span>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" @click="openInstall">Install / manage repositories</Button>
					<Button variant="destructive" :disabled="disconnecting" @click="disconnect.mutate()">Disconnect</Button>
				</div>
			</template>

			<template v-else>
				<p class="text-sm text-muted-foreground">
					Creates a GitHub App on your account or organization. You’ll be redirected to GitHub to review permissions, then back here.
				</p>
				<div>
					<Button :disabled="connecting" @click="connect.mutate()">Connect GitHub</Button>
				</div>
			</template>
		</CardContent>
	</Card>
</template>
