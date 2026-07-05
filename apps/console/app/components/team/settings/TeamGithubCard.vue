<script setup lang="ts">
import { Github } from 'lucide-vue-next';

const { activeTeam, activeTeamId } = useTeamContext();
const route = useRoute();
const router = useRouter();

const isOwner = computed(() => activeTeam.value?.role === 'owner');

const { data: connection } = useTeamGitConnection(activeTeamId);
const { data: installations } = useGitInstallations(activeTeamId);
const bind = useBindGitInstallation(activeTeamId);

const connected = computed(() => connection.value?.connected ?? false);

function openInstall() {
	if (connection.value?.installUrl) window.open(connection.value.installUrl, '_blank', 'noopener');
}

// Bind the installation GitHub sends back to on the setup redirect, once the active team is known.
const bound = ref(false);
watch(
	activeTeamId,
	id => {
		if (bound.value || !id) return;
		const installationId = typeof route.query.installation_id === 'string' ? route.query.installation_id : null;
		if (installationId && route.query.setup_action === 'install') {
			bound.value = true;
			bind
				.mutateAsync(installationId)
				.catch(() => {})
				.finally(() => router.replace({ query: { tab: 'github' } }));
		}
	},
	{ immediate: true }
);
</script>

<template>
	<Card>
		<CardHeader>
			<div class="flex items-start justify-between gap-3">
				<div>
					<CardTitle class="flex items-center gap-2">
						<Github class="size-4 text-muted-foreground" />
						GitHub repositories
					</CardTitle>
					<CardDescription class="mt-1">Install the platform’s GitHub App on your repositories to deploy them as services.</CardDescription>
				</div>
				<Badge :variant="connected ? 'default' : 'secondary'" class="shrink-0">{{ connected ? 'Available' : 'Not configured' }}</Badge>
			</div>
		</CardHeader>

		<CardContent class="flex flex-col gap-4">
			<template v-if="!connected">
				<p class="text-sm text-muted-foreground">
					No GitHub App is connected on this platform yet. Ask an administrator to connect one in
					<span class="font-medium text-foreground">platform settings → Integrations</span>, then install it here.
				</p>
			</template>

			<template v-else>
				<div v-if="(installations?.length ?? 0) > 0" class="flex flex-col gap-2">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Installed accounts</span>
					<ul class="flex flex-col gap-1">
						<li v-for="inst in installations ?? []" :key="inst.id" class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
							<Github class="size-3.5 text-muted-foreground" />
							<span class="font-medium">{{ inst.accountLogin }}</span>
							<Badge v-if="inst.suspended" variant="secondary" class="ml-auto">Suspended</Badge>
						</li>
					</ul>
				</div>
				<p v-else class="text-sm text-muted-foreground">
					No repositories installed yet. Install the App to pick which repositories this team can deploy.
				</p>

				<div v-if="isOwner">
					<Button variant="outline" :disabled="bind.isPending.value" @click="openInstall">Install / manage repositories</Button>
				</div>
				<p v-else class="text-xs text-muted-foreground">Only team owners can install or change repository access.</p>
			</template>
		</CardContent>
	</Card>
</template>
