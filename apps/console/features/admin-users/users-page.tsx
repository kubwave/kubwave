'use client';

import { MailIcon, SearchIcon, ShieldCheckIcon, UserPlusIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatTile } from '@/components/stat-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InvitationsTable } from './invitations-table';
import { InviteUserDialog } from './invite-user-dialog';
import { MembersTable } from './members-table';
import { filterInvitations, filterUsers, openInvitations, pageOf } from './model';
import { TablePager } from './table-parts';
import { useAdminUsers, useInvitations } from './use-admin-users';

function Stat({ label, value, icon, loading }: { label: string; value: number; icon: React.ReactNode; loading: boolean }) {
	return <StatTile label={label} icon={icon} value={loading ? <Skeleton className="h-8 w-10" /> : <span className="tabular-nums">{value}</span>} />;
}

export function UsersPage() {
	const { data: users = [], isPending: usersLoading } = useAdminUsers();
	const { data: invitations = [], isPending: invitationsLoading } = useInvitations();
	const [tab, setTab] = useState('members');
	const [query, setQuery] = useState('');
	const [memberPage, setMemberPage] = useState(1);
	const [invitationPage, setInvitationPage] = useState(1);
	const [inviteOpen, setInviteOpen] = useState(false);

	const pending = openInvitations(invitations);
	const members = pageOf(filterUsers(users, query), memberPage);
	const invites = pageOf(filterInvitations(pending, query), invitationPage);
	const inviterName = (userId: string | null) => users.find(user => user.id === userId)?.name;

	const search = (value: string) => {
		setQuery(value);
		setMemberPage(1);
		setInvitationPage(1);
	};

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
			<PageHeader
				title="Users"
				description="Everyone with an account on this kubwave instance. Admins manage the cluster and platform settings."
				actions={
					<Button size="sm" onClick={() => setInviteOpen(true)}>
						<UserPlusIcon />
						Invite user
					</Button>
				}
			/>

			<section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
				<Stat label="Members" value={users.length} icon={<UsersIcon className="size-4" />} loading={usersLoading} />
				<Stat label="Admins" value={users.filter(user => user.isAdmin).length} icon={<ShieldCheckIcon className="size-4" />} loading={usersLoading} />
				<Stat label="Pending invitations" value={pending.length} icon={<MailIcon className="size-4" />} loading={invitationsLoading} />
			</section>

			<Tabs value={tab} onValueChange={setTab} className="gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<TabsList>
						<TabsTrigger value="members">
							Members <span className="text-muted-foreground tabular-nums">{users.length}</span>
						</TabsTrigger>
						<TabsTrigger value="invitations">
							Invitations <span className="text-muted-foreground tabular-nums">{pending.length}</span>
						</TabsTrigger>
					</TabsList>
					<div className="relative w-full sm:w-64">
						<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={event => search(event.target.value)}
							placeholder={tab === 'members' ? 'Search by name or email…' : 'Search by email…'}
							aria-label={tab === 'members' ? 'Search members' : 'Search invitations'}
							className="h-8 pl-8"
						/>
					</div>
				</div>

				<TabsContent value="members">
					<MembersTable users={members.items} loading={usersLoading} query={query} />
					<TablePager page={members.page} pageCount={members.pageCount} onPageChange={setMemberPage} />
				</TabsContent>
				<TabsContent value="invitations">
					<InvitationsTable invitations={invites.items} loading={invitationsLoading} query={query} inviterName={inviterName} />
					<TablePager page={invites.page} pageCount={invites.pageCount} onPageChange={setInvitationPage} />
				</TabsContent>
			</Tabs>

			<InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={() => setTab('invitations')} />
		</div>
	);
}
