'use client';

import {
	BlocksIcon,
	CheckCircle2Icon,
	EllipsisIcon,
	ExternalLinkIcon,
	KeyRoundIcon,
	LogOutIcon,
	SettingsIcon,
	ShieldIcon,
	SparklesIcon,
	Trash2Icon,
	UploadIcon,
	UserIcon,
	UserMinusIcon,
	UserPlusIcon,
	UsersIcon
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/auth-kit';
import { ConfirmDelete } from '@/components/confirm-delete';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { GitHubIcon, ServiceIcon } from '@/components/service/service-icon';
import { type Section, SettingsCard, SettingsLayout } from '@/components/settings-layout';
import { useAppState } from '@/components/shell/app-state';
import { TeamAvatar } from '@/components/shell/team-switcher';
import { UserAvatar } from '@/components/shell/user-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { type Team, teams } from '@/lib/mock';
import { githubInstallations, type Member, membersByTeam, randomChars, type SshKey, sshKeys } from '@/lib/mock-settings';
import { cn } from '@/lib/utils';
import { CodeBlock, Count, DangerRow, EmptyRow, InfoItem, ListCard, RowIcon, useHashSection, WithTooltip } from './parts';
import { SaveBar, useDraft } from './save-bar';

const sectionIds = ['general', 'members', 'ssh-keys', 'integrations'];
const keyPrefix: Record<SshKey['type'], string> = {
	ed25519: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI',
	rsa: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ',
	ecdsa: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBB'
};

function RoleBadge({ role }: { role: Member['role'] }) {
	return (
		<Badge variant="outline" className={role === 'owner' ? '' : 'text-muted-foreground'}>
			{role === 'owner' ? 'Owner' : 'Member'}
		</Badge>
	);
}

function MemberAvatar({ member }: { member: Member }) {
	return <UserAvatar initials={member.initials} className="size-8" />;
}

export function TeamSettings() {
	const { teamId } = useAppState();
	const team = teams.find(t => t.id === teamId)!;
	return <TeamSettingsView key={team.id} team={team} />;
}

function TeamSettingsView({ team }: { team: Team }) {
	const router = useRouter();
	const [section, setSection] = useHashSection(sectionIds);
	const [members, setMembers] = useState(membersByTeam[team.id] ?? []);
	const [keys, setKeys] = useState(team.id === 'acme' ? sshKeys : []);
	const [isDefault, setIsDefault] = useState(team.isDefault);
	const general = useDraft({ name: team.name });

	const isOwner = members.some(m => m.you && m.role === 'owner');
	const soleOwner = isOwner && members.filter(m => m.role === 'owner').length === 1;
	const teamName = general.saved.name;

	const save = () => {
		if (!general.draft.name.trim()) return toast.error('Team name cannot be empty');
		general.save();
		toast.success('Team settings saved');
	};
	const leave = (message: string) => {
		toast.success(message, { description: 'Preview only — nothing was changed.' });
		router.push('/');
	};
	const setRole = (m: Member, role: Member['role']) => {
		setMembers(ms => ms.map(x => (x.id === m.id ? { ...x, role } : x)));
		toast.success(`${m.name} is now ${role === 'owner' ? 'an owner' : 'a member'}`);
	};
	const remove = (m: Member) => {
		const index = members.indexOf(m);
		setMembers(ms => ms.filter(x => x.id !== m.id));
		toast(`${m.name} was removed from ${teamName}`, {
			action: { label: 'Undo', onClick: () => setMembers(ms => [...ms.slice(0, index), m, ...ms.slice(index)]) }
		});
	};

	const sections: Section[] = [
		{ id: 'general', label: 'General', icon: SettingsIcon },
		{ id: 'members', label: 'Members', icon: UsersIcon, badge: <Count n={members.length} /> },
		{ id: 'ssh-keys', label: 'SSH keys', icon: KeyRoundIcon, badge: <Count n={keys.length} /> },
		{ id: 'integrations', label: 'Integrations', icon: BlocksIcon }
	];

	return (
		<div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
			<PageHeader
				eyebrow="Team settings"
				title={
					<span className="flex items-center gap-3">
						<TeamAvatar name={teamName} className="size-7 text-sm" />
						{teamName}
					</span>
				}
				description="Members, deploy keys and Git integrations shared by every project in this team."
			/>
			<SettingsLayout sections={sections} active={section} onChange={setSection}>
				{section === 'general' && (
					<>
						<SettingsCard
							title="Team name"
							description="Shown in the team switcher, on invitations and when scoping MCP tokens."
							footer={
								<>
									<p className="mr-auto text-xs text-muted-foreground">{isOwner ? 'Up to 64 characters.' : 'Only owners can rename the team.'}</p>
									<Button size="sm" disabled={!general.changes || !general.draft.name.trim()} onClick={save}>
										Save
									</Button>
								</>
							}
						>
							<Label htmlFor="team-name" className="sr-only">
								Team name
							</Label>
							<Input
								id="team-name"
								value={general.draft.name}
								maxLength={64}
								disabled={!isOwner}
								onChange={e => general.set('name', e.target.value)}
								className="max-w-sm"
							/>
						</SettingsCard>

						<SettingsCard title="Team info">
							<dl className="grid gap-5 sm:grid-cols-3">
								<InfoItem label="Team ID">
									<code className="truncate font-mono text-xs">{team.id}</code>
									<CopyButton value={team.id} label="Copy team ID" />
								</InfoItem>
								<InfoItem label="Your role">
									<RoleBadge role={isOwner ? 'owner' : 'member'} />
								</InfoItem>
								<InfoItem label="Members">
									<span className="tabular-nums">{members.length}</span>
								</InfoItem>
								<InfoItem label="Member since">{team.joinedAt}</InfoItem>
								<InfoItem label="Default team">
									{isDefault ? (
										<Badge variant="secondary" className="text-[11px]">
											<CheckCircle2Icon className="text-success" />
											Default
										</Badge>
									) : (
										<Button
											variant="link"
											size="xs"
											className="h-auto px-0"
											onClick={() => {
												setIsDefault(true);
												toast.success(`${teamName} is now your default team`);
											}}
										>
											Make default
										</Button>
									)}
								</InfoItem>
							</dl>
						</SettingsCard>

						<SettingsCard title="Danger zone" tone="danger">
							<div className="divide-y">
								<DangerRow title="Leave team" description={`You will lose access to every project in ${teamName}.`}>
									<WithTooltip tip={soleOwner && 'You are the only owner. Make someone else an owner first.'}>
										<LeaveTeamDialog teamName={teamName} disabled={soleOwner} onLeave={() => leave(`You left ${teamName}`)} />
									</WithTooltip>
								</DangerRow>
								<DangerRow title="Delete team" description="Permanently deletes the team with all projects, environments, services and volumes.">
									<WithTooltip tip={!isOwner && 'Only owners can delete the team.'}>
										{isOwner ? (
											<ConfirmDelete
												name={teamName}
												title={`Delete ${teamName}?`}
												description="All projects, environments, services, volumes and deployments in this team are deleted. This cannot be undone."
												onConfirm={() => leave(`${teamName} was deleted`)}
											>
												<Button variant="destructive" size="sm">
													<Trash2Icon />
													Delete team
												</Button>
											</ConfirmDelete>
										) : (
											<Button variant="destructive" size="sm" disabled>
												<Trash2Icon />
												Delete team
											</Button>
										)}
									</WithTooltip>
								</DangerRow>
							</div>
						</SettingsCard>
					</>
				)}

				{section === 'members' && (
					<ListCard
						title="Members"
						description={`${members.length} ${members.length === 1 ? 'person has' : 'people have'} access to ${teamName}. Owners can manage members and rename or delete the team.`}
						action={
							<WithTooltip tip={!isOwner && 'Only owners can add members.'}>
								<AddMemberDialog teamName={teamName} disabled={!isOwner} members={members} onAdd={m => setMembers(ms => [...ms, m])} />
							</WithTooltip>
						}
					>
						{members.map(m => (
							<li key={m.id} className="flex items-center gap-3 px-5 py-3">
								<MemberAvatar member={m} />
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="truncate text-sm font-medium">{m.name}</span>
										{m.you && (
											<Badge variant="outline" className="px-1.5 py-0 text-[10px]">
												You
											</Badge>
										)}
									</div>
									<p className="truncate text-xs text-muted-foreground">
										{m.email} · joined {m.joined}
									</p>
								</div>
								<RoleBadge role={m.role} />
								{isOwner && !m.you ? (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon-sm" aria-label={`Manage ${m.name}`}>
												<EllipsisIcon />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="w-48">
											{m.role === 'member' ? (
												<DropdownMenuItem onSelect={() => setRole(m, 'owner')}>
													<ShieldIcon />
													Make owner
												</DropdownMenuItem>
											) : (
												<DropdownMenuItem onSelect={() => setRole(m, 'member')}>
													<UserIcon />
													Make member
												</DropdownMenuItem>
											)}
											<DropdownMenuSeparator />
											<DropdownMenuItem variant="destructive" onSelect={() => remove(m)}>
												<UserMinusIcon />
												Remove from team
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								) : (
									<span className="size-8" aria-hidden />
								)}
							</li>
						))}
					</ListCard>
				)}

				{section === 'ssh-keys' && (
					<ListCard
						title="SSH keys"
						description="Deploy keys for cloning private Git repositories over SSH. Add the public key to your Git host with read access."
						action={<AddKeyDialog onAdd={k => setKeys(ks => [k, ...ks])} />}
					>
						{keys.length === 0 && (
							<EmptyRow
								icon={KeyRoundIcon}
								title="No SSH keys yet"
								description="Generate a key pair in kubwave, or upload a private key you already use."
							/>
						)}
						{keys.map(k => (
							<li key={k.id} className="flex items-center gap-3 px-5 py-3.5">
								<RowIcon icon={KeyRoundIcon} />
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="text-sm font-medium">{k.name}</span>
										<Badge variant="outline" className="px-1.5 font-mono text-[10px]">
											{k.type}
										</Badge>
										<Badge variant="secondary" className="px-1.5 text-[10px]">
											{k.source === 'generated' ? 'Generated' : 'Uploaded'}
										</Badge>
									</div>
									<p className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
										<span className="truncate font-mono">{k.fingerprint}</span>
										<span className="shrink-0">· added {k.added}</span>
									</p>
								</div>
								<CopyButton value={k.publicKey} label={`Copy public key of ${k.name}`} />
								<ConfirmDelete
									name={k.name}
									title="Delete SSH key"
									description="Services that clone with this key will fail on their next build."
									onConfirm={() => {
										setKeys(ks => ks.filter(x => x.id !== k.id));
										toast.success(`SSH key ${k.name} deleted`);
									}}
								>
									<Button variant="ghost" size="icon-xs" aria-label={`Delete ${k.name}`} className="text-muted-foreground hover:text-destructive">
										<Trash2Icon />
									</Button>
								</ConfirmDelete>
							</li>
						))}
					</ListCard>
				)}

				{section === 'integrations' && (
					<>
						<SettingsCard
							title={
								<span className="flex items-center gap-2">
									<GitHubIcon className="size-4" />
									GitHub
									<Badge variant="outline" className="border-success/30 bg-success/10 text-[11px] text-success">
										Available
									</Badge>
								</span>
							}
							description="Deploy from GitHub repositories with push-to-deploy and PR previews, through the kubwave GitHub App."
							footer={
								<>
									<p className="mr-auto text-xs text-muted-foreground">Repository access is managed on GitHub.</p>
									<Button size="sm" variant="outline" onClick={() => toast('Opening GitHub…', { description: 'Preview only — no redirect.' })}>
										<GitHubIcon className="size-4" />
										Install / manage repositories
										<ExternalLinkIcon className="text-muted-foreground" />
									</Button>
								</>
							}
						>
							<ul className="divide-y rounded-md border">
								{githubInstallations.map(i => (
									<li key={i.id} className={cn('flex items-center gap-3 px-3 py-2.5', i.suspended && 'bg-warning/5')}>
										<span
											className={cn(
												'flex size-7 shrink-0 items-center justify-center bg-foreground text-xs font-semibold text-background',
												i.kind === 'User' ? 'rounded-full' : 'rounded-md'
											)}
										>
											{i.account[0]!.toUpperCase()}
										</span>
										<div className="min-w-0 flex-1">
											<p className="flex items-center gap-2 text-sm font-medium">
												<span className="truncate font-mono">{i.account}</span>
												{i.suspended && (
													<Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">
														Suspended
													</Badge>
												)}
											</p>
											<p className="text-xs text-muted-foreground">
												{i.kind} · {i.repos === 'all' ? 'All repositories' : `${i.repos} repositories`}
											</p>
										</div>
										<Button
											variant="ghost"
											size="xs"
											onClick={() => toast(`Opening ${i.account} on GitHub…`, { description: 'Preview only — no redirect.' })}
										>
											Configure
											<ExternalLinkIcon />
										</Button>
									</li>
								))}
							</ul>
						</SettingsCard>

						<SettingsCard
							title={
								<span className="flex items-center gap-2">
									<ServiceIcon type="gitea-repo" />
									Gitea
									<Badge variant="secondary" className="text-[11px]">
										Not configured
									</Badge>
								</span>
							}
							description="Deploy from repositories on your self-hosted Gitea instance, with webhooks for push-to-deploy."
							footer={
								<Button size="sm" onClick={() => toast('Redirecting to Gitea…', { description: 'Preview only — no redirect.' })}>
									Connect Gitea account
								</Button>
							}
						>
							<div className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
								No Gitea account connected. You will be asked to authorize kubwave on <span className="font-mono text-foreground">git.acme.dev</span>.
							</div>
						</SettingsCard>
					</>
				)}
			</SettingsLayout>
			<SaveBar changes={general.changes} onDiscard={general.discard} onSave={save} />
		</div>
	);
}

function LeaveTeamDialog({ teamName, disabled, onLeave }: { teamName: string; disabled: boolean; onLeave: () => void }) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" disabled={disabled} className="text-destructive hover:text-destructive">
					<LogOutIcon />
					Leave team
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Leave {teamName}?</DialogTitle>
					<DialogDescription>You lose access to its projects immediately. An owner has to add you again to regain access.</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button variant="destructive" onClick={onLeave}>
						Leave team
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AddMemberDialog({
	teamName,
	disabled,
	members,
	onAdd
}: {
	teamName: string;
	disabled: boolean;
	members: Member[];
	onAdd: (m: Member) => void;
}) {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState('');
	const address = email.trim().toLowerCase();
	const taken = members.some(m => m.email === address);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const name = address
			.split('@')[0]!
			.split(/[._-]/)
			.filter(Boolean)
			.map(s => s[0]!.toUpperCase() + s.slice(1))
			.join(' ');
		const initials = name
			.split(' ')
			.map(s => s[0])
			.join('')
			.slice(0, 2);
		onAdd({ id: `u-${Date.now()}`, name, email: address, initials, role: 'member', joined: 'just now' });
		toast.success(`${name} was added to ${teamName}`);
		setOpen(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={o => {
				setOpen(o);
				if (o) setEmail('');
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm" disabled={disabled}>
					<UserPlusIcon />
					Add member
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="grid gap-4">
					<DialogHeader>
						<DialogTitle>Add member</DialogTitle>
						<DialogDescription>They need an existing account on this kubwave instance and join as a Member.</DialogDescription>
					</DialogHeader>
					<Field
						id="member-email"
						label="Email"
						type="email"
						required
						autoFocus
						autoComplete="off"
						placeholder="teammate@acme.dev"
						value={email}
						onChange={e => setEmail(e.target.value)}
						aria-invalid={taken || undefined}
						hint={taken && <p className="text-xs text-destructive">Already a member of {teamName}.</p>}
					/>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={!address || taken}>
							Add member
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function AddKeyDialog({ onAdd }: { onAdd: (k: SshKey) => void }) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState('generate');
	const [name, setName] = useState('');
	const [privateKey, setPrivateKey] = useState('');
	const [generated, setGenerated] = useState<SshKey | null>(null);
	const pem = privateKey.trim();
	const pemValid = /^-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----$/.test(pem);
	const valid = name.trim() && (tab === 'generate' || pemValid);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const type: SshKey['type'] = tab === 'generate' ? 'ed25519' : pem.includes('BEGIN RSA') ? 'rsa' : pem.includes('BEGIN EC') ? 'ecdsa' : 'ed25519';
		const key: SshKey = {
			id: `k-${Date.now()}`,
			name: name.trim(),
			type,
			source: tab === 'generate' ? 'generated' : 'uploaded',
			fingerprint: `SHA256:${randomChars(43)}`,
			added: 'just now',
			publicKey: `${keyPrefix[type]}${randomChars(type === 'rsa' ? 96 : 43)} kubwave@${name.trim()}`
		};
		onAdd(key);
		if (tab === 'generate') return setGenerated(key);
		toast.success(`SSH key ${key.name} uploaded`);
		setOpen(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={o => {
				setOpen(o);
				if (!o) return;
				setTab('generate');
				setName('');
				setPrivateKey('');
				setGenerated(null);
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm">
					<KeyRoundIcon />
					Add key
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				{generated ? (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<CheckCircle2Icon className="size-5 text-success" />
								Key generated
							</DialogTitle>
							<DialogDescription>
								Add this public key as a read-only deploy key on your Git host. The private key never leaves the cluster.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-2">
							<div className="flex items-center justify-between gap-2 text-xs">
								<span className="font-medium">Public key</span>
								<span className="truncate font-mono text-muted-foreground">{generated.fingerprint}</span>
							</div>
							<CodeBlock value={generated.publicKey} label="Copy public key" wrap />
						</div>
						<DialogFooter>
							<DialogClose asChild>
								<Button>Done</Button>
							</DialogClose>
						</DialogFooter>
					</>
				) : (
					<form onSubmit={submit} className="grid gap-4">
						<DialogHeader>
							<DialogTitle>Add SSH key</DialogTitle>
							<DialogDescription>Generate a fresh key pair, or upload a private key you already use as a deploy key.</DialogDescription>
						</DialogHeader>
						<Tabs value={tab} onValueChange={setTab} className="gap-4">
							<TabsList className="w-full">
								<TabsTrigger value="generate">
									<SparklesIcon />
									Generate
								</TabsTrigger>
								<TabsTrigger value="upload">
									<UploadIcon />
									Upload
								</TabsTrigger>
							</TabsList>
							<Field
								id="ssh-key-name"
								label="Name"
								required
								autoFocus
								autoComplete="off"
								placeholder="deploy-storefront"
								value={name}
								onChange={e => setName(e.target.value)}
								hint={<p className="text-xs text-muted-foreground">Shown when picking a key for a private repository service.</p>}
							/>
							<TabsContent value="generate">
								<p className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
									kubwave generates an <span className="font-mono text-foreground">ed25519</span> key pair and stores the private key encrypted. You
									get the public key to paste into your Git host.
								</p>
							</TabsContent>
							<TabsContent value="upload" className="grid gap-2">
								<Label htmlFor="ssh-private-key">Private key</Label>
								<Textarea
									id="ssh-private-key"
									spellCheck={false}
									value={privateKey}
									onChange={e => setPrivateKey(e.target.value)}
									aria-invalid={(pem && !pemValid) || undefined}
									placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
									className="max-h-48 min-h-32 font-mono text-xs"
								/>
								<p className={cn('text-xs', pem && !pemValid ? 'text-destructive' : 'text-muted-foreground')}>
									{pem && !pemValid
										? 'Paste the full PEM block, including the BEGIN and END lines.'
										: 'ed25519, RSA and ECDSA keys are supported. Stored encrypted.'}
								</p>
							</TabsContent>
						</Tabs>
						<DialogFooter>
							<DialogClose asChild>
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</DialogClose>
							<Button type="submit" disabled={!valid}>
								{tab === 'generate' ? 'Generate key' : 'Upload key'}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
