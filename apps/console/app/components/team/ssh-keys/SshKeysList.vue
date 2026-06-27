<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import { Copy, KeyRound, Trash2 } from 'lucide-vue-next';
import { queryKeys } from '~/utils/query-keys';
import { formatRelative } from '~/utils/format';
import type { SshKey } from '~/utils/types';

// `action` (the add button) is passed via the #action slot.
const props = defineProps<{ activeTeamId: string | null; isOwner: boolean }>();

function sshKeyErrorMessage(error: string): string {
	switch (error) {
		case 'ssh_key_not_found':
			return 'That key no longer exists.';
		case 'team_forbidden':
			return 'Only owners can delete SSH keys.';
		case 'team_not_found':
			return 'This team is no longer available to you.';
		default:
			return 'Something went wrong. Please try again.';
	}
}

const { activeTeam, isPending: teamsLoading } = useTeamContext();
const api = useApi();
const queryClient = useQueryClient();
const confirm = useConfirm();
const toast = useToast();
const busyKeyId = ref<string | null>(null);

const activeTeamIdRef = computed(() => props.activeTeamId);
const { data: keys, isPending: keysLoading } = useTeamSshKeys(activeTeamIdRef);

const isLoading = computed(() => teamsLoading.value || (!!props.activeTeamId && keysLoading.value));
const keyList = computed<SshKey[]>(() => keys.value ?? []);

async function copyPublicKey(key: SshKey) {
	try {
		await navigator.clipboard.writeText(key.publicKey);
		toast.success('Public key copied', `${key.name}’s public key is on your clipboard.`);
	} catch {
		toast.error('Could not copy', 'Copy the public key manually.');
	}
}

async function handleDelete(key: SshKey) {
	if (!props.activeTeamId) return;
	const confirmed = await confirm({
		title: 'Delete SSH key',
		description: `Delete “${key.name}”? Anything using this key will lose access. This cannot be undone.`,
		confirmLabel: 'Delete key',
		destructive: true
	});
	if (!confirmed) return;

	busyKeyId.value = key.id;
	try {
		const deleted = await apiData(api.teams(props.activeTeamId).sshKeys(key.id).delete()).catch(err => {
			toast.error('Could not delete key', sshKeyErrorMessage(errorCode(err)));
			return null;
		});
		if (!deleted) return;
		await queryClient.invalidateQueries({ queryKey: queryKeys.teamSshKeys(props.activeTeamId) });
		toast.success('SSH key deleted', `${key.name} was removed.`);
	} catch {
		toast.error('Could not delete key', 'Could not reach the server.');
	} finally {
		busyKeyId.value = null;
	}
}
</script>

<template>
	<Card class="gap-0 overflow-hidden py-0">
		<CardHeader class="border-b py-4">
			<div class="flex flex-row items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="text-base font-semibold">SSH keys</span>
					<Badge v-if="keyList.length > 0" variant="secondary" class="tabular-nums">{{ keyList.length }}</Badge>
				</div>
				<slot name="action" />
			</div>
		</CardHeader>

		<div v-if="isLoading" class="divide-y">
			<div v-for="i in 2" :key="i" class="flex items-center gap-3 px-6 py-3.5">
				<Skeleton class="size-7 rounded-md" />
				<div class="flex flex-1 flex-col gap-1.5">
					<Skeleton class="h-3.5 w-32" />
					<Skeleton class="h-3 w-64" />
				</div>
			</div>
		</div>

		<div v-else-if="!activeTeam" class="flex flex-col items-center gap-2 px-4 py-10 text-center">
			<KeyRound class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No team selected.</p>
		</div>

		<EmptyState
			v-else-if="keyList.length === 0"
			variant="inline"
			:icon="KeyRound"
			title="No SSH keys yet"
			description="Generate or upload a key to use it as a deploy key for private repositories."
		>
			<template v-if="isOwner" #action>
				<slot name="action" />
			</template>
		</EmptyState>

		<ul v-else class="divide-y">
			<li v-for="key in keyList" :key="key.id" class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
				<div class="flex min-w-0 items-center gap-3">
					<span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70">
						<KeyRound class="size-3.5" />
					</span>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-1.5">
							<span class="truncate text-sm font-medium">{{ key.name }}</span>
							<Badge variant="secondary" class="shrink-0 uppercase">{{ key.keyType }}</Badge>
							<Badge variant="outline" class="shrink-0">{{ key.source === 'generated' ? 'Generated' : 'Uploaded' }}</Badge>
						</div>
						<p class="mt-0.5 truncate font-mono text-xs text-muted-foreground">{{ key.fingerprint }}</p>
						<p class="mt-0.5 text-xs text-muted-subtle">Added {{ formatRelative(key.createdAt) }}</p>
					</div>
				</div>

				<div class="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						class="size-8 text-muted-foreground"
						aria-label="Copy public key"
						title="Copy public key"
						@click="copyPublicKey(key)"
					>
						<Copy />
					</Button>
					<Button
						v-if="isOwner"
						variant="ghost"
						size="icon"
						class="size-8 text-destructive hover:text-destructive"
						:disabled="busyKeyId === key.id"
						aria-label="Delete SSH key"
						title="Delete SSH key"
						@click="handleDelete(key)"
					>
						<Trash2 />
					</Button>
				</div>
			</li>
		</ul>
	</Card>
</template>
