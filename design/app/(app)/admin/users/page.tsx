'use client';

import {
	CircleCheckIcon,
	CircleXIcon,
	ClockIcon,
	EllipsisIcon,
	SearchIcon,
	SendIcon,
	ShieldCheckIcon,
	ShieldIcon,
	ShieldOffIcon,
	Trash2Icon,
	UserPlusIcon,
	XIcon
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDelete } from '@/components/confirm-delete';
import { PageHeader } from '@/components/page-header';
import { UserAvatar } from '@/components/shell/user-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { currentUser } from '@/lib/mock';
import { adminUsers, invitations as initialInvitations, type AdminUser, type Invitation } from '@/lib/mock-admin';
import { cn } from '@/lib/utils';

const inviteStatus: Record<Invitation['status'], { icon: React.ComponentType<{ className?: string }>; label: string; className: string }> = {
	pending: { icon: ClockIcon, label: 'Pending', className: 'text-info' },
	accepted: { icon: CircleCheckIcon, label: 'Accepted', className: 'text-success' },
	expired: { icon: CircleXIcon, label: 'Expired', className: 'text-muted-foreground' }
};

function RoleBadge({ role }: { role: AdminUser['role'] }) {
	return role === 'admin' ? (
		<Badge variant="outline" className="border-primary/30 text-primary-text">
			<ShieldIcon />
			Admin
		</Badge>
	) : (
		<Badge variant="outline" className="text-muted-foreground">
			Member
		</Badge>
	);
}

function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={label}>
					<EllipsisIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default function UsersPage() {
	const [users, setUsers] = useState(adminUsers);
	const [invites, setInvites] = useState(initialInvitations);
	const [tab, setTab] = useState('members');
	const [query, setQuery] = useState('');

	const q = query.trim().toLowerCase();
	const shownUsers = users.filter(u => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
	const shownInvites = invites.filter(i => !q || i.email.toLowerCase().includes(q));

	const setRole = (u: AdminUser, role: AdminUser['role']) => {
		setUsers(prev => prev.map(x => (x.id === u.id ? { ...x, role } : x)));
		toast.success(role === 'admin' ? `${u.name} is now an admin` : `Removed admin access from ${u.name}`);
	};

	const invite = (email: string, admin: boolean) => {
		setInvites(prev => [
			{ id: `i${Date.now()}`, email, role: admin ? 'admin' : 'member', status: 'pending', invited: 'Just now', invitedBy: currentUser.name },
			...prev
		]);
		setTab('invitations');
		toast.success(`Invitation sent to ${email}`, { description: admin ? 'They will join with admin access.' : 'The link expires in 7 days.' });
	};

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
			<PageHeader
				title="Users"
				description="Everyone with an account on this kubwave instance. Admins manage the cluster and platform settings."
				actions={
					<InviteDialog onInvite={invite} taken={[...users.map(u => u.email), ...invites.filter(i => i.status === 'pending').map(i => i.email)]} />
				}
			/>

			<Tabs value={tab} onValueChange={setTab} className="gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<TabsList>
						<TabsTrigger value="members">
							Members <span className="text-muted-foreground tabular-nums">{users.length}</span>
						</TabsTrigger>
						<TabsTrigger value="invitations">
							Invitations <span className="text-muted-foreground tabular-nums">{invites.length}</span>
						</TabsTrigger>
					</TabsList>
					<div className="relative w-full sm:w-64">
						<SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Search by name or email…"
							aria-label="Search users"
							className="h-8 pl-8"
						/>
					</div>
				</div>

				<TabsContent value="members">
					<div className="overflow-hidden rounded-lg border bg-card">
						<Table>
							<TableHeader>
								<TableRow className="hover:bg-transparent">
									<TableHead className="pl-4">User</TableHead>
									<TableHead>Role</TableHead>
									<TableHead className="text-right">Teams</TableHead>
									<TableHead>Joined</TableHead>
									<TableHead>Last active</TableHead>
									<TableHead className="w-12" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{shownUsers.map(u => {
									const self = u.email === currentUser.email;
									return (
										<TableRow key={u.id}>
											<TableCell className="pl-4">
												<div className="flex items-center gap-3">
													<UserAvatar initials={u.initials} className="size-8" />
													<div className="min-w-0">
														<div className="flex items-center gap-2 font-medium">
															{u.name}
															{self && (
																<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
																	You
																</Badge>
															)}
														</div>
														<div className="text-xs text-muted-foreground">{u.email}</div>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<RoleBadge role={u.role} />
											</TableCell>
											<TableCell className="text-right text-muted-foreground tabular-nums">{u.teams}</TableCell>
											<TableCell className="text-muted-foreground">{u.joined}</TableCell>
											<TableCell className={cn('text-muted-foreground', u.lastActive === 'Now' && 'text-success')}>{u.lastActive}</TableCell>
											<TableCell className="pr-3 text-right">
												<RowMenu label={`Actions for ${u.name}`}>
													{u.role === 'member' ? (
														<DropdownMenuItem onSelect={() => setRole(u, 'admin')}>
															<ShieldCheckIcon />
															Make admin
														</DropdownMenuItem>
													) : (
														<DropdownMenuItem disabled={self} onSelect={() => setRole(u, 'member')}>
															<ShieldOffIcon />
															Remove admin
														</DropdownMenuItem>
													)}
													<DropdownMenuSeparator />
													<ConfirmDelete
														name={u.email}
														title={`Delete ${u.name}?`}
														description="Their sessions and API tokens are revoked immediately. Projects owned by their teams are kept."
														onConfirm={() => {
															setUsers(prev => prev.filter(x => x.id !== u.id));
															toast.success(`Deleted ${u.name}`);
														}}
													>
														<DropdownMenuItem variant="destructive" disabled={self} onSelect={e => e.preventDefault()}>
															<Trash2Icon />
															Delete user
														</DropdownMenuItem>
													</ConfirmDelete>
												</RowMenu>
											</TableCell>
										</TableRow>
									);
								})}
								{!shownUsers.length && (
									<TableRow className="hover:bg-transparent">
										<TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
											No users match “{query}”.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</TabsContent>

				<TabsContent value="invitations">
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
								{shownInvites.map(i => {
									const s = inviteStatus[i.status];
									return (
										<TableRow key={i.id}>
											<TableCell className="pl-4 font-medium">{i.email}</TableCell>
											<TableCell>
												<RoleBadge role={i.role} />
											</TableCell>
											<TableCell>
												<span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.className)}>
													<s.icon className="size-3.5" />
													{s.label}
												</span>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{i.invited} <span className="text-xs">· by {i.invitedBy}</span>
											</TableCell>
											<TableCell className="pr-3 text-right">
												{i.status !== 'accepted' && (
													<RowMenu label={`Actions for invitation to ${i.email}`}>
														<DropdownMenuItem
															onSelect={() => {
																setInvites(prev =>
																	prev.map((x): Invitation => (x.id === i.id ? { ...x, status: 'pending', invited: 'Just now' } : x))
																);
																toast.success(`Invitation resent to ${i.email}`);
															}}
														>
															<SendIcon />
															Resend
														</DropdownMenuItem>
														<DropdownMenuItem
															variant="destructive"
															onSelect={() => {
																setInvites(prev => prev.filter(x => x.id !== i.id));
																toast.success(`Revoked invitation for ${i.email}`);
															}}
														>
															<XIcon />
															Revoke
														</DropdownMenuItem>
													</RowMenu>
												)}
											</TableCell>
										</TableRow>
									);
								})}
								{!shownInvites.length && (
									<TableRow className="hover:bg-transparent">
										<TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
											{q ? `No invitations match “${query}”.` : 'No invitations yet.'}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function InviteDialog({ onInvite, taken }: { onInvite: (email: string, admin: boolean) => void; taken: string[] }) {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState('');
	const [admin, setAdmin] = useState(false);
	const [touched, setTouched] = useState(false);
	const value = email.trim().toLowerCase();
	const error = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
		? 'Enter a valid email address.'
		: taken.includes(value)
			? 'This person already has an account or a pending invitation.'
			: null;

	return (
		<Dialog
			open={open}
			onOpenChange={o => {
				setOpen(o);
				if (!o) {
					setEmail('');
					setAdmin(false);
					setTouched(false);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm">
					<UserPlusIcon />
					Invite user
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form
					className="grid gap-4"
					onSubmit={e => {
						e.preventDefault();
						setTouched(true);
						if (error) return;
						onInvite(value, admin);
						setOpen(false);
						setEmail('');
						setAdmin(false);
						setTouched(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>Invite user</DialogTitle>
						<DialogDescription>They get an email with a sign-up link. Team membership is managed per team.</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="invite-email">Email</Label>
						<Input
							id="invite-email"
							type="email"
							autoFocus
							placeholder="name@company.com"
							value={email}
							onChange={e => setEmail(e.target.value)}
							aria-invalid={touched && !!error}
							aria-describedby="invite-email-error"
						/>
						{touched && error && (
							<p id="invite-email-error" className="text-xs text-destructive">
								{error}
							</p>
						)}
					</div>
					<label htmlFor="invite-admin" className="flex items-start justify-between gap-4 rounded-md border p-3">
						<span className="space-y-0.5">
							<span className="block text-sm font-medium">Grant admin access</span>
							<span className="block text-xs text-muted-foreground">Can manage the cluster, users and platform settings.</span>
						</span>
						<Switch id="invite-admin" checked={admin} onCheckedChange={setAdmin} />
					</label>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit">
							<SendIcon />
							Send invitation
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
