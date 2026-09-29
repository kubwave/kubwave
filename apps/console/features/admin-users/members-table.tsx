'use client';

import { ShieldCheckIcon, ShieldOffIcon, Trash2Icon } from 'lucide-react';
import { useConfirm } from '@/components/confirm-provider';
import { Badge } from '@/components/ui/badge';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/features/auth/session-provider';
import { UserAvatar } from '@/features/shell/avatars';
import { formatRelative } from '@/lib/format';
import type { AdminUser } from './model';
import { EmptyTableRow, RoleBadge, RowMenu, SkeletonRows } from './table-parts';
import { useDeleteUser, useSetAdmin } from './use-admin-users';

const COLUMNS = 4;

export function MembersTable({ users, loading, query }: { users: AdminUser[]; loading: boolean; query: string }) {
	const { user: me } = useSession();
	const confirm = useConfirm();
	const setAdmin = useSetAdmin();
	const deleteUser = useDeleteUser();
	const busy = (user: AdminUser) =>
		(setAdmin.isPending && setAdmin.variables.user.id === user.id) || (deleteUser.isPending && deleteUser.variables.id === user.id);

	const changeRole = (user: AdminUser, isAdmin: boolean) => setAdmin.mutate({ user, isAdmin });

	const remove = async (user: AdminUser) => {
		const confirmed = await confirm({
			title: `Delete ${user.name}?`,
			description: 'This permanently removes their account and revokes all their sessions. This cannot be undone.',
			confirmLabel: 'Delete user',
			confirmationText: user.email,
			destructive: true
		});
		if (!confirmed) return;
		deleteUser.mutate(user);
	};

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">User</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Joined</TableHead>
						<TableHead className="w-12" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{loading && users.length === 0 && <SkeletonRows columns={COLUMNS} />}
					{!loading && users.length === 0 && (
						<EmptyTableRow columns={COLUMNS}>{query ? `No users match “${query}”.` : 'No members yet.'}</EmptyTableRow>
					)}
					{users.map(user => {
						const self = user.id === me?.id;
						return (
							<TableRow key={user.id}>
								<TableCell className="pl-4">
									<div className="flex items-center gap-3">
										<UserAvatar name={user.name} className="size-8" />
										<div className="min-w-0">
											<div className="flex items-center gap-2 font-medium">
												<span className="truncate">{user.name}</span>
												{self && (
													<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
														You
													</Badge>
												)}
											</div>
											<div className="truncate text-xs text-muted-foreground">{user.email}</div>
										</div>
									</div>
								</TableCell>
								<TableCell>
									<RoleBadge isAdmin={user.isAdmin} />
								</TableCell>
								<TableCell className="text-muted-foreground">{formatRelative(user.createdAt)}</TableCell>
								<TableCell className="pr-3 text-right">
									{/* The API refuses self-demotion and self-deletion, so there is nothing to offer on your own row. */}
									{!self && (
										<RowMenu label={`Actions for ${user.name}`} disabled={busy(user)}>
											{user.isAdmin ? (
												<DropdownMenuItem onSelect={() => changeRole(user, false)}>
													<ShieldOffIcon />
													Remove admin
												</DropdownMenuItem>
											) : (
												<DropdownMenuItem onSelect={() => changeRole(user, true)}>
													<ShieldCheckIcon />
													Make admin
												</DropdownMenuItem>
											)}
											<DropdownMenuSeparator />
											<DropdownMenuItem variant="destructive" onSelect={() => void remove(user)}>
												<Trash2Icon />
												Delete user
											</DropdownMenuItem>
										</RowMenu>
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
