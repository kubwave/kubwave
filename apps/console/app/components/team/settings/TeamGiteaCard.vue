<script setup lang="ts">
import { GitFork } from 'lucide-vue-next';

const { activeTeam, activeTeamId } = useTeamContext();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const isOwner = computed(() => activeTeam.value?.role === 'owner');

const { data: connection } = useTeamGiteaConnection(activeTeamId);
const { data: accounts } = useGiteaInstallations(activeTeamId);
const claim = useClaimGiteaAccount(activeTeamId);
const unbind = useUnbindGiteaAccount(activeTeamId);

const connected = computed(() => connection.value?.connected ?? false);

function openAuthorize() {
	if (connection.value?.authorizeUrl) window.location.href = connection.value.authorizeUrl;
}

const handled = ref(false);
watch(
	[activeTeamId, () => route.query],
	() => {
		const id = activeTeamId.value;
		if (handled.value || !id) return;
		const q = route.query;
		if (!q.git_grant && !q.git_error) return;
		handled.value = true;
		if (typeof q.git_grant === 'string') {
			claim.mutateAsync(q.git_grant).catch(() => {});
		} else {
			toast.error('Could not connect Gitea');
		}
		router.replace({ query: { tab: 'gitea' } });
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
						<GitFork class="size-4 text-muted-foreground" />
						Gitea repositories
					</CardTitle>
					<CardDescription class="mt-1">Authorize the platform’s Gitea OAuth app so this team can deploy repositories.</CardDescription>
				</div>
				<Badge :variant="connected ? 'default' : 'secondary'" class="shrink-0">{{ connected ? 'Available' : 'Not configured' }}</Badge>
			</div>
		</CardHeader>

		<CardContent class="flex flex-col gap-4">
			<template v-if="!connected">
				<p class="text-sm text-muted-foreground">
					No Gitea OAuth application is connected on this platform yet. Ask an administrator to connect one in
					<span class="font-medium text-foreground">platform settings → Integrations</span>, then authorize it here.
				</p>
			</template>

			<template v-else>
				<div v-if="(accounts?.length ?? 0) > 0" class="flex flex-col gap-2">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Connected accounts</span>
					<ul class="flex flex-col gap-1">
						<li v-for="account in accounts ?? []" :key="account.id" class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
							<GitFork class="size-3.5 text-muted-foreground" />
							<span class="font-medium">{{ account.accountLogin }}</span>
							<Button v-if="isOwner" variant="ghost" size="sm" class="ml-auto" :disabled="unbind.isPending.value" @click="unbind.mutate(account.id)">
								Disconnect
							</Button>
						</li>
					</ul>
				</div>
				<p v-else class="text-sm text-muted-foreground">
					No Gitea account connected yet. Authorize access to pick repositories this team can deploy.
				</p>

				<div v-if="isOwner">
					<Button variant="outline" @click="openAuthorize">Connect Gitea account</Button>
				</div>
				<p v-else class="text-xs text-muted-foreground">Only team owners can connect or change Gitea access.</p>
			</template>
		</CardContent>
	</Card>
</template>
