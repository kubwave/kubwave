'use client';

import { BotIcon, BracesIcon, CheckCircle2Icon, KeyRoundIcon, PlusIcon, TerminalIcon, TerminalSquareIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/auth-kit';
import { SettingsCard } from '@/components/settings-layout';
import { StatusDot } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { teams } from '@/lib/mock';
import { type McpAccess as McpAccessEntry, type McpScope, mcpEndpoint, mcpScopes, randomChars } from '@/lib/mock-settings';
import { cn } from '@/lib/utils';
import { CodeBlock, CopyField, EmptyRow, ListCard, RowIcon } from './parts';

const alnum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const mcpOrigin = new URL(mcpEndpoint).origin;

const oauthSteps = [
	'Add the endpoint as a remote HTTP MCP server in your client.',
	'Sign in and approve the requested scopes in the browser window that opens.',
	'The client appears under connected clients below. Revoke it any time.'
];

const statusBadge: Record<McpAccessEntry['status'], React.ReactNode> = {
	active: (
		<span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
			<StatusDot className="size-1.5 bg-success" />
			Active
		</span>
	),
	expired: (
		<Badge variant="secondary" className="px-1.5 text-[10px]">
			Expired
		</Badge>
	),
	revoked: (
		<Badge variant="outline" className="border-destructive/30 px-1.5 text-[10px] text-destructive">
			Revoked
		</Badge>
	)
};

function ScopeChip({ value }: { value: McpScope }) {
	const scope = mcpScopes.find(s => s.value === value)!;
	return (
		<span
			className={cn(
				'inline-flex items-center rounded border px-1.5 py-px text-[11px]',
				scope.destructive ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
			)}
		>
			{scope.label}
		</span>
	);
}

export function McpAccess({
	entries,
	setEntries
}: {
	entries: McpAccessEntry[];
	setEntries: React.Dispatch<React.SetStateAction<McpAccessEntry[]>>;
}) {
	const active = entries.filter(e => e.status === 'active').length;
	const revoke = (entry: McpAccessEntry) => {
		setEntries(es => es.map(e => (e.id === entry.id ? { ...e, status: 'revoked' as const } : e)));
		toast.success(`Revoked access for ${entry.name}`, { description: 'Requests with its credentials are rejected from now on.' });
	};

	return (
		<>
			<SettingsCard
				title="Connect with OAuth"
				description="OAuth-capable clients like Claude Code only need the endpoint URL. They open a browser window where you approve the requested scopes — no token to copy around."
			>
				<div className="space-y-4">
					<CopyField value={mcpEndpoint} label="MCP endpoint" />
					<ol className="grid gap-2 sm:grid-cols-3">
						{oauthSteps.map((step, i) => (
							<li key={step} className="flex gap-2.5 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
								<span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px] text-foreground">
									{i + 1}
								</span>
								{step}
							</li>
						))}
					</ol>
					<CodeBlock value={`claude mcp add --transport http kubwave ${mcpEndpoint}`} label="Copy command" />
				</div>
			</SettingsCard>

			<SettingsCard
				title="Create personal token"
				description="For clients without OAuth, or for scripts and CI. A token acts as you, limited to the scopes and team you choose."
			>
				<div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center">
					<RowIcon icon={KeyRoundIcon} className="bg-background" />
					<p className="flex-1 text-xs text-muted-foreground">
						Send it as <code className="font-mono text-foreground">Authorization: Bearer kw_…</code>. It is shown once and expires after 7, 30 or 90
						days.
					</p>
					<CreateTokenDialog onCreate={e => setEntries(es => [e, ...es])} />
				</div>
			</SettingsCard>

			<ListCard title="Connected clients and tokens" description={`${active} active · revoke anything you no longer use.`}>
				{entries.length === 0 && (
					<EmptyRow icon={BotIcon} title="No AI access yet" description="Connect an OAuth-capable client or create a personal token." />
				)}
				{entries.map(e => {
					const inactive = e.status !== 'active';
					return (
						<li key={e.id} className="flex items-start gap-3 px-5 py-3.5">
							<RowIcon icon={e.kind === 'oauth' ? BotIcon : KeyRoundIcon} className={cn(inactive && 'opacity-50')} />
							<div className={cn('min-w-0 flex-1 space-y-1.5', inactive && 'opacity-60')}>
								<div className="flex flex-wrap items-center gap-2">
									<span className="text-sm font-medium">{e.name}</span>
									<Badge variant="outline" className="px-1.5 text-[10px]">
										{e.kind === 'oauth' ? 'OAuth' : 'Personal token'}
									</Badge>
									{statusBadge[e.status]}
								</div>
								<div className="flex flex-wrap gap-1">
									{e.scopes.map(s => (
										<ScopeChip key={s} value={s} />
									))}
								</div>
								<p className="text-xs text-muted-foreground">
									{e.team} · created {e.created} · {e.status === 'expired' ? 'expired' : 'expires'} {e.expires}
									{e.lastUsed && ` · last used ${e.lastUsed}`}
								</p>
							</div>
							{!inactive && (
								<Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => revoke(e)}>
									Revoke
								</Button>
							)}
						</li>
					);
				})}
			</ListCard>
		</>
	);
}

function CreateTokenDialog({ onCreate }: { onCreate: (entry: McpAccessEntry) => void }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [scopes, setScopes] = useState<McpScope[]>(['read']);
	const [team, setTeam] = useState('all');
	const [days, setDays] = useState('30');
	const [created, setCreated] = useState<{ token: string; entry: McpAccessEntry } | null>(null);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const entry: McpAccessEntry = {
			id: `m-${Date.now()}`,
			name: name.trim(),
			kind: 'personal',
			scopes: mcpScopes.map(s => s.value).filter(v => scopes.includes(v)),
			team: team === 'all' ? 'All teams' : teams.find(t => t.id === team)!.name,
			created: 'just now',
			expires: new Date(Date.now() + Number(days) * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
			status: 'active'
		};
		onCreate(entry);
		setCreated({ token: `kw_${randomChars(40, alnum)}`, entry });
	};

	const token = created?.token ?? '';
	const snippets = [
		{
			id: 'claude',
			label: 'Claude Code',
			icon: TerminalIcon,
			value: `claude mcp add --transport http kubwave ${mcpEndpoint} --header "Authorization: Bearer ${token}"`,
			wrap: true
		},
		{
			id: 'json',
			label: 'JSON config',
			icon: BracesIcon,
			value: JSON.stringify({ mcpServers: { kubwave: { type: 'http', url: mcpEndpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
			wrap: false
		},
		{
			id: 'stdio',
			label: 'stdio (kubwave mcp)',
			icon: TerminalSquareIcon,
			value: `KUBWAVE_URL=${mcpOrigin} KUBWAVE_MCP_TOKEN=${token} kubwave mcp`,
			wrap: true
		}
	];

	return (
		<Dialog
			open={open}
			onOpenChange={o => {
				setOpen(o);
				if (!o) return;
				setName('');
				setScopes(['read']);
				setTeam('all');
				setDays('30');
				setCreated(null);
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm">
					<PlusIcon />
					Create token
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
				{created ? (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<CheckCircle2Icon className="size-5 text-success" />
								Token created
							</DialogTitle>
							<DialogDescription>Copy the token now. It will not be shown again.</DialogDescription>
						</DialogHeader>
						<div className="grid gap-2">
							<CopyField value={token} label="Token" />
							<div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
								{created.entry.scopes.map(s => (
									<ScopeChip key={s} value={s} />
								))}
								<span className="ml-1">
									{created.entry.team} · expires {created.entry.expires}
								</span>
							</div>
						</div>
						<Tabs defaultValue="claude" className="gap-3">
							<TabsList className="w-full">
								{snippets.map(s => (
									<TabsTrigger key={s.id} value={s.id}>
										<s.icon />
										{s.label}
									</TabsTrigger>
								))}
							</TabsList>
							{snippets.map(s => (
								<TabsContent key={s.id} value={s.id}>
									<CodeBlock value={s.value} label={`Copy ${s.label} snippet`} wrap={s.wrap} />
								</TabsContent>
							))}
						</Tabs>
						<DialogFooter>
							<DialogClose asChild>
								<Button>Done</Button>
							</DialogClose>
						</DialogFooter>
					</>
				) : (
					<form onSubmit={submit} className="grid gap-5">
						<DialogHeader>
							<DialogTitle>Create personal token</DialogTitle>
							<DialogDescription>The token acts as you, limited to the scopes and team below.</DialogDescription>
						</DialogHeader>
						<Field
							id="token-name"
							label="Name"
							required
							autoFocus
							autoComplete="off"
							placeholder="laptop claude-code"
							value={name}
							onChange={e => setName(e.target.value)}
							hint={<p className="text-xs text-muted-foreground">A label to recognise this token by.</p>}
						/>
						<fieldset className="grid gap-2">
							<legend className="mb-2 text-sm font-medium">Scopes</legend>
							<div className="divide-y rounded-md border">
								{mcpScopes.map(s => (
									<label
										key={s.value}
										htmlFor={`scope-${s.value}`}
										className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
									>
										<Checkbox
											id={`scope-${s.value}`}
											className="mt-0.5"
											checked={scopes.includes(s.value)}
											onCheckedChange={c => setScopes(cur => (c === true ? [...cur, s.value] : cur.filter(v => v !== s.value)))}
										/>
										<span className="grid gap-0.5">
											<span className={cn('flex items-center gap-1.5 text-sm font-medium', s.destructive && 'text-destructive')}>
												{s.label}
												{s.destructive && <TriangleAlertIcon className="size-3.5" />}
												<code className="font-mono text-[10px] font-normal text-muted-foreground">{s.value}</code>
											</span>
											<span className="text-xs text-muted-foreground">{s.description}</span>
										</span>
									</label>
								))}
							</div>
							{scopes.length === 0 && <p className="text-xs text-destructive">Pick at least one scope.</p>}
						</fieldset>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="token-team">Team access</Label>
								<Select value={team} onValueChange={setTeam}>
									<SelectTrigger id="token-team" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All my teams</SelectItem>
										{teams.map(t => (
											<SelectItem key={t.id} value={t.id}>
												{t.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="token-expiry">Expires after</Label>
								<Select value={days} onValueChange={setDays}>
									<SelectTrigger id="token-expiry" className="w-full">
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
						<DialogFooter>
							<DialogClose asChild>
								<Button type="button" variant="outline">
									Cancel
								</Button>
							</DialogClose>
							<Button type="submit" disabled={!name.trim() || scopes.length === 0}>
								Create token
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
