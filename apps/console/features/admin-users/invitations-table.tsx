'use client';

import { CircleXIcon, ClockIcon, SendIcon, XIcon } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { expiryLabel, type Invitation } from './model';
import { EmptyTableRow, RoleBadge, RowMenu, SkeletonRows } from './table-parts';
import { useResendInvitation, useRevokeInvitation } from './use-admin-users';

const COLUMNS = 5;

export function InvitationsTable({
	invitations,
	loading,
	query,
	inviterName
}: {
	invitations: Invitation[];
	loading: boolean;
	query: string;
	inviterName: (userId: string | null) => string | undefined;
}) {
	const resend = useResendInvitation();
	const revoke = useRevokeInvitation();
	const busy = (invitation: Invitation) =>
		(resend.isPending && resend.variables.id === invitation.id) || (revoke.isPending && revoke.variables.id === invitation.id);
	const resendInvite = (invitation: Invitation) => resend.mutate(invitation);
	const revokeInvite = (invitation: Invitation) => revoke.mutate(invitation);

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="pl-4">Email</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Invited</TableHead>
						<TableHead className="w-12" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{loading && invitations.length === 0 && <SkeletonRows columns={COLUMNS} />}
					{!loading && invitations.length === 0 && (
						<EmptyTableRow columns={COLUMNS}>
							{query ? `No invitations match “${query}”.` : 'No pending invitations. Invitations you send appear here until they’re accepted.'}
						</EmptyTableRow>
					)}
					{invitations.map(invitation => {
						const expired = invitation.status === 'expired';
						const StatusIcon = expired ? CircleXIcon : ClockIcon;
						const inviter = inviterName(invitation.invitedBy);
						return (
							<TableRow key={invitation.id}>
								<TableCell className="pl-4 font-medium">{invitation.email}</TableCell>
								<TableCell>
									<RoleBadge isAdmin={invitation.isAdmin} />
								</TableCell>
								<TableCell>
									<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', expired ? 'text-muted-foreground' : 'text-info')}>
										<StatusIcon className="size-3.5" />
										{expired ? 'Expired' : 'Pending'}
									</span>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{formatRelative(invitation.createdAt)}
									{inviter && <span className="text-xs"> · by {inviter}</span>}
									<div className="text-xs">{expiryLabel(invitation.expiresAt)}</div>
								</TableCell>
								<TableCell className="pr-3 text-right">
									<RowMenu label={`Actions for invitation to ${invitation.email}`} disabled={busy(invitation)}>
										<DropdownMenuItem onSelect={() => resendInvite(invitation)}>
											<SendIcon />
											Resend
										</DropdownMenuItem>
										<DropdownMenuItem variant="destructive" onSelect={() => revokeInvite(invitation)}>
											<XIcon />
											Revoke
										</DropdownMenuItem>
									</RowMenu>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
