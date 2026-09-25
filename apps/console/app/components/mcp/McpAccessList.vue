<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { McpAccessDto } from '@kubwave/api-client';
import { Bot, KeyRound, Trash2 } from 'lucide-vue-next';
import { formatDateTime, formatRelative } from '~/utils/format';
import { mcpScope } from '~/utils/mcp';
import { queryKeys } from '~/utils/query-keys';

const api = useApi();
const queryClient = useQueryClient();
const confirm = useConfirm();
const toast = useToast();
const { teams } = useTeamContext();

const { data: entries, isPending } = useQuery({ queryKey: queryKeys.mcpAccess, queryFn: () => apiData(api.mcp.access.get()) });
const busyId = ref<string | null>(null);

function status(entry: McpAccessDto): string | null {
	if (entry.revokedAt) return 'Revoked';
	return new Date(entry.expiresAt) <= new Date() ? 'Expired' : null;
}

function details(entry: McpAccessDto): string {
	const team = entry.teamId ? (teams.value.find(t => t.id === entry.teamId)?.name ?? 'One team') : 'All teams';
	const projects = entry.projectIds.length ? ` · ${entry.projectIds.length} projects` : '';
	const end = entry.revokedAt ? `Revoked ${formatRelative(entry.revokedAt)}` : `Expires ${formatDateTime(entry.expiresAt)}`;
	return `${team}${projects} · Created ${formatRelative(entry.createdAt)} · ${end}`;
}

async function revoke(entry: McpAccessDto) {
	const confirmed = await confirm({
		title: 'Revoke access',
		description: `Revoke “${entry.name}”? Clients using it lose access immediately. This cannot be undone.`,
		confirmLabel: 'Revoke',
		destructive: true
	});
	if (!confirmed) return;

	busyId.value = entry.id;
	try {
		await apiData(api.mcp.access(entry.id).delete());
		await queryClient.invalidateQueries({ queryKey: queryKeys.mcpAccess });
		toast.success('Access revoked', `${entry.name} can no longer use Kubwave.`);
	} catch {
		toast.error('Could not revoke access', 'Please try again.');
	} finally {
		busyId.value = null;
	}
}
</script>

<template>
	<Card class="gap-0 overflow-hidden py-0">
		<CardHeader class="border-b py-4">
			<span class="text-base font-semibold">Connected clients and tokens</span>
		</CardHeader>

		<div v-if="isPending" class="divide-y">
			<div v-for="i in 2" :key="i" class="flex items-center gap-3 px-6 py-3.5">
				<Skeleton class="size-7 rounded-md" />
				<div class="flex flex-1 flex-col gap-1.5">
					<Skeleton class="h-3.5 w-32" />
					<Skeleton class="h-3 w-64" />
				</div>
			</div>
		</div>

		<EmptyState
			v-else-if="!entries?.length"
			variant="inline"
			:icon="Bot"
			title="No AI access yet"
			description="Connect an OAuth-capable client or create a personal token."
		/>

		<ul v-else class="divide-y">
			<li
				v-for="entry in entries"
				:key="entry.id"
				:class="['flex items-center justify-between gap-3 px-4 py-3 sm:px-6', status(entry) ? 'opacity-60' : '']"
			>
				<div class="flex min-w-0 items-center gap-3">
					<span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70">
						<component :is="entry.kind === 'oauth' ? Bot : KeyRound" class="size-3.5" />
					</span>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-1.5">
							<span class="truncate text-sm font-medium">{{ entry.name }}</span>
							<Badge variant="outline">{{ entry.kind === 'oauth' ? 'OAuth' : 'Personal token' }}</Badge>
							<Badge v-if="status(entry)" variant="secondary">{{ status(entry) }}</Badge>
						</div>
						<div class="mt-1 flex flex-wrap gap-1">
							<Badge
								v-for="scope in entry.scopes.map(mcpScope)"
								:key="scope.value"
								size="sm"
								:variant="scope.destructive ? 'destructive' : 'secondary'"
							>
								{{ scope.label }}
							</Badge>
						</div>
						<p class="mt-1 text-xs text-muted-subtle">{{ details(entry) }}</p>
					</div>
				</div>

				<Button
					v-if="!status(entry)"
					variant="ghost"
					size="icon"
					class="size-8 shrink-0 text-destructive hover:text-destructive"
					:disabled="busyId === entry.id"
					aria-label="Revoke access"
					title="Revoke access"
					@click="revoke(entry)"
				>
					<Trash2 />
				</Button>
			</li>
		</ul>
	</Card>
</template>
