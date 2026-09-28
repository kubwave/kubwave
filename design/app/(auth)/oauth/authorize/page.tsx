'use client';

import { EyeIcon, LockIcon, PencilIcon, RocketIcon, SquareTerminalIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuthCard } from '@/components/auth/auth-kit';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { currentUser, teams } from '@/lib/mock';
import { cn } from '@/lib/utils';

const client = { name: 'Claude Code', redirectHost: '127.0.0.1:53682' };

const scopes = [
	{ name: 'Read', icon: EyeIcon, description: 'View projects, services, logs and metrics.' },
	{ name: 'Write', icon: PencilIcon, description: 'Create and update projects, services and variables.' },
	{ name: 'Deploy', icon: RocketIcon, description: 'Trigger, redeploy and cancel deployments.' },
	{ name: 'Delete', icon: Trash2Icon, description: 'Permanently delete projects, environments and services.', destructive: true },
	{ name: 'Manage teams', icon: UsersIcon, description: 'Invite and remove members and change their roles.', destructive: true }
];

export default function OAuthAuthorizePage() {
	const router = useRouter();
	const [team, setTeam] = useState('all');
	const [days, setDays] = useState('30');
	const teamLabel = team === 'all' ? 'all your teams' : teams.find(t => t.id === team)!.name;

	return (
		<AuthCard
			className="max-w-md"
			tagline="Model Context Protocol · OAuth 2.1"
			footer={
				<>
					Signed in as <span className="font-mono text-foreground">{currentUser.email}</span> ·{' '}
					<Link href="/login" className="underline-offset-4 hover:text-foreground hover:underline">
						Switch account
					</Link>
				</>
			}
		>
			<div className="mb-5 flex items-center justify-center gap-3" aria-hidden>
				<span className="flex size-12 items-center justify-center rounded-xl border bg-[#d97757]/10 text-[#d97757]">
					<SquareTerminalIcon className="size-6" />
				</span>
				<span className="flex items-center gap-1.5">
					<span className="w-5 border-t border-dashed border-muted-foreground/40" />
					<span className="flex size-6 items-center justify-center rounded-full border bg-background">
						<LockIcon className="size-3 text-muted-foreground" />
					</span>
					<span className="w-5 border-t border-dashed border-muted-foreground/40" />
				</span>
				<span className="flex size-12 items-center justify-center rounded-xl border bg-muted">
					<img src="/logo.png" alt="" className="size-7" />
				</span>
			</div>

			<div className="mb-5 space-y-1.5 text-center">
				<h1 className="text-xl font-semibold tracking-tight">Authorize {client.name}</h1>
				<p className="text-sm text-muted-foreground">
					<span className="text-foreground">{client.name}</span> wants to access your kubwave account.
				</p>
				<p className="text-xs text-muted-foreground">
					Redirects to <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{client.redirectHost}</code>
				</p>
			</div>

			<div className="mb-2 text-xs font-medium text-muted-foreground">This will allow {client.name} to:</div>
			<ul className="mb-5 divide-y rounded-lg border">
				{scopes.map(s => (
					<li key={s.name} className="flex items-start gap-3 px-3 py-2.5">
						<span
							className={cn(
								'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border',
								s.destructive ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
							)}
						>
							<s.icon className="size-3.5" />
						</span>
						<div className="min-w-0">
							<div className={cn('text-sm font-medium', s.destructive && 'text-destructive')}>{s.name}</div>
							<div className="text-xs text-muted-foreground">{s.description}</div>
						</div>
					</li>
				))}
			</ul>

			<div className="mb-6 grid grid-cols-2 gap-3">
				<div className="grid gap-2">
					<Label htmlFor="team-access">Team access</Label>
					<Select value={team} onValueChange={setTeam}>
						<SelectTrigger id="team-access" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All teams</SelectItem>
							{teams.map(t => (
								<SelectItem key={t.id} value={t.id}>
									{t.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="expires">Expires after</Label>
					<Select value={days} onValueChange={setDays}>
						<SelectTrigger id="expires" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{['7', '30', '90'].map(d => (
								<SelectItem key={d} value={d}>
									{d} days
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<Button
					variant="outline"
					onClick={() => {
						toast('Authorization denied', { description: `${client.name} was not granted access.` });
						router.push('/');
					}}
				>
					Deny
				</Button>
				<Button
					onClick={() => {
						toast.success(`${client.name} authorized`, { description: `Access to ${teamLabel} for ${days} days.` });
						router.push('/account#ai-access');
					}}
				>
					Approve
				</Button>
			</div>
			<p className="mt-4 text-center text-xs text-balance text-muted-foreground">
				Only approve if you started this from {client.name}. You can revoke access anytime under Account → AI access.
			</p>
		</AuthCard>
	);
}
