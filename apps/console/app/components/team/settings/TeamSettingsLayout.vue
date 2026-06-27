<script setup lang="ts">
import { CalendarDays, Hash, KeyRound, Settings2, Shield, ShieldAlert, Star, Trash2, Users } from 'lucide-vue-next';

type SettingsTab = 'general' | 'members' | 'ssh-keys';

const props = withDefaults(defineProps<{ initialTab?: SettingsTab }>(), { initialTab: 'general' });

const confirm = useConfirm();
const { activeTeam, activeTeamId, isPending } = useTeamContext();

const isOwner = computed(() => activeTeam.value?.role === 'owner');

const { data: members } = useTeamMembers(activeTeamId);
const deleteMutation = useDeleteTeam(activeTeam);

async function onDelete() {
	if (!activeTeam.value) return;
	const confirmed = await confirm({
		title: 'Delete team',
		description: `This permanently deletes ${activeTeam.value.name} and removes all of its members. This cannot be undone.`,
		confirmLabel: 'Delete team',
		destructive: true,
		confirmationText: activeTeam.value.name
	});
	if (!confirmed) return;
	deleteMutation.mutate(activeTeam.value.id);
}

const tab = ref<SettingsTab>(props.initialTab);

// Keep the URL shareable: switching tabs only rewrites the address bar (client-only).
watch(tab, value => {
	if (import.meta.client) {
		const query = value === 'general' ? '' : `?tab=${value}`;
		window.history.replaceState(null, '', `/team/settings${query}`);
	}
});

const memberSince = computed(() =>
	activeTeam.value ? new Date(activeTeam.value.joinedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
);
</script>

<template>
	<div v-if="isPending && !activeTeam" class="flex flex-col gap-6">
		<div>
			<Skeleton class="h-7 w-48" />
			<Skeleton class="mt-2 h-4 w-64" />
		</div>
	</div>

	<p v-else-if="!activeTeam" class="text-sm text-muted-foreground">No team selected.</p>

	<div v-else class="flex flex-col gap-6">
		<PageHeader title="Team settings">
			<template #description>
				Manage <span class="font-medium text-foreground">{{ activeTeam.name }}</span
				>'s profile, members and lifecycle.
			</template>
		</PageHeader>

		<Tabs v-model="tab">
			<TabsList>
				<TabsTrigger value="general">
					<Settings2 />
					General
				</TabsTrigger>
				<TabsTrigger value="members">
					<Users />
					Members
				</TabsTrigger>
				<TabsTrigger value="ssh-keys">
					<KeyRound />
					SSH keys
				</TabsTrigger>
			</TabsList>
		</Tabs>

		<div v-if="tab === 'general'" class="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
			<div class="flex flex-col gap-6 lg:col-span-2">
				<TeamSettingsForm :team="{ id: activeTeam.id, name: activeTeam.name }" :is-owner="isOwner" />

				<Card v-if="isOwner" class="gap-0 border-destructive/20 bg-destructive/5 py-0 transition-shadow hover:shadow-sm">
					<CardHeader class="py-6">
						<CardTitle class="flex items-center gap-2 text-destructive/90">
							<ShieldAlert class="size-4" />
							Danger zone
						</CardTitle>
					</CardHeader>

					<CardContent class="pb-6">
						<p class="text-sm font-medium text-destructive/80">Delete this team</p>
						<p class="mt-1 text-sm text-muted-foreground">Permanently removes the team and all of its memberships. This action cannot be undone.</p>
					</CardContent>

					<CardFooter class="justify-between gap-3 rounded-b-xl border-t border-destructive/15 bg-destructive/5 pb-4">
						<p class="text-xs text-muted-foreground">This action is permanent.</p>
						<Button variant="destructive" size="sm" :disabled="deleteMutation.isPending.value" class="shrink-0" @click="onDelete">
							<Trash2 v-if="!deleteMutation.isPending.value" />
							{{ deleteMutation.isPending.value ? 'Deleting…' : 'Delete team' }}
						</Button>
					</CardFooter>
				</Card>
			</div>

			<div class="lg:col-span-1">
				<div class="sticky top-6">
					<Card>
						<CardHeader>
							<CardTitle class="flex items-center gap-2">
								<Shield class="size-4 text-muted-foreground/70" />
								Team info
							</CardTitle>
							<CardDescription>Details about {{ activeTeam.name }}.</CardDescription>
						</CardHeader>

						<CardContent>
							<ul class="space-y-4">
								<li class="flex items-start gap-3">
									<span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70">
										<Hash class="size-3.5" />
									</span>
									<div class="min-w-0">
										<p class="text-xs text-muted-foreground">Team ID</p>
										<p class="mt-0.5 truncate font-mono text-xs">{{ activeTeam.id }}</p>
									</div>
								</li>

								<li class="flex items-start gap-3">
									<span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70">
										<Shield class="size-3.5" />
									</span>
									<div class="min-w-0">
										<p class="text-xs text-muted-foreground">Your role</p>
										<div class="mt-0.5">
											<Badge size="sm" :variant="isOwner ? 'default' : 'secondary'" class="font-medium uppercase tracking-wider">
												{{ activeTeam.role }}
											</Badge>
										</div>
									</div>
								</li>

								<li class="flex items-start gap-3">
									<span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70">
										<Users class="size-3.5" />
									</span>
									<div class="min-w-0">
										<p class="text-xs text-muted-foreground">Members</p>
										<p class="mt-0.5 font-medium">{{ members?.length ?? '…' }}</p>
									</div>
								</li>

								<li class="flex items-start gap-3">
									<span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70">
										<CalendarDays class="size-3.5" />
									</span>
									<div class="min-w-0">
										<p class="text-xs text-muted-foreground">Member since</p>
										<p class="mt-0.5 font-medium">{{ memberSince }}</p>
									</div>
								</li>

								<li class="flex items-start gap-3">
									<span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70">
										<Star class="size-3.5" />
									</span>
									<div class="min-w-0">
										<p class="text-xs text-muted-foreground">Default team</p>
										<div class="mt-0.5">
											<Badge size="sm" :variant="activeTeam.isDefault ? 'default' : 'secondary'" class="font-medium uppercase tracking-wider">
												{{ activeTeam.isDefault ? 'Yes' : 'No' }}
											</Badge>
										</div>
									</div>
								</li>
							</ul>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>

		<div v-else-if="tab === 'members'">
			<MembersList :active-team-id="activeTeamId" :is-owner="isOwner">
				<template #action>
					<MembersAddButton :active-team-id="activeTeamId" :is-owner="isOwner" />
				</template>
			</MembersList>
		</div>

		<div v-else-if="tab === 'ssh-keys'">
			<SshKeysList :active-team-id="activeTeamId" :is-owner="isOwner">
				<template #action>
					<SshKeysAddButton :active-team-id="activeTeamId" :is-owner="isOwner" />
				</template>
			</SshKeysList>
		</div>
	</div>
</template>
