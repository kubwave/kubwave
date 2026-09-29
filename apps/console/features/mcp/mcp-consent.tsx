'use client';

import { apiData, type McpAuthorizationDto } from '@kubwave/api-client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LockIcon, SquareTerminalIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthCard } from '@/features/auth/auth-kit';
import { useSession } from '@/features/auth/session-provider';
import { useTeams } from '@/features/team/use-teams';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { MCP_EXPIRY_DAYS, mcpScope } from '@/lib/mcp';
import { cn } from '@/lib/utils';
import { ScopeList } from './scope-list';

function hostOf(uri: string): string {
	return (URL.canParse(uri) && new URL(uri).host) || uri;
}

export function McpConsent({ request }: { request: McpAuthorizationDto }) {
	const { user } = useSession();
	const { teams } = useTeams();
	const [teamId, setTeamId] = useState('all');
	const [expiresInDays, setExpiresInDays] = useState('30');
	const details = useQuery({
		queryKey: queryKeys.mcpAuthorization(JSON.stringify(request)),
		queryFn: () => apiData(getBrowserApi().mcp.authorization.post(request)),
		retry: false
	});
	const decide = useMutation({
		mutationFn: (approve: boolean) =>
			apiData(
				getBrowserApi().mcp.consent.post({
					...request,
					approve,
					teamId: teamId === 'all' ? undefined : teamId,
					expiresInDays: Number(expiresInDays)
				})
			),
		onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
		onError: () => toast.error('Could not complete authorization', { description: 'Start the connection again from your AI client.' })
	});

	if (details.isPending)
		return (
			<AuthCard className="max-w-md" tagline="Model Context Protocol · OAuth 2.1">
				<div className="grid gap-3">
					<Skeleton className="h-5 w-48" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-24 w-full" />
				</div>
			</AuthCard>
		);
	if (!details.data)
		return (
			<AuthCard
				className="max-w-md"
				title="Invalid authorization request"
				description="This link is invalid, expired, or does not match a registered client. Start the connection again from your AI client."
			>
				<Button asChild variant="outline" className="w-full">
					<Link href="/">Back to the console</Link>
				</Button>
			</AuthCard>
		);

	const { clientName, redirectUri, scopes } = details.data;
	const busy = decide.isPending || decide.isSuccess;

	return (
		<AuthCard
			className="max-w-md"
			tagline="Model Context Protocol · OAuth 2.1"
			footer={
				user && (
					<>
						Signed in as <span className="font-mono text-foreground">{user.email}</span>
					</>
				)
			}
		>
			<div className="mb-5 flex items-center justify-center gap-3" aria-hidden>
				<span className="flex size-12 items-center justify-center rounded-xl border bg-muted text-foreground">
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
				<h1 className="text-xl font-semibold tracking-tight">Authorize {clientName}</h1>
				<p className="text-sm text-muted-foreground">
					<span className="text-foreground">{clientName}</span> wants to access kubwave on your behalf.
				</p>
				<p className="text-xs text-muted-foreground">
					Redirects to <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{hostOf(redirectUri)}</code>
				</p>
			</div>

			<div className="mb-2 text-xs font-medium text-muted-foreground">This will allow {clientName} to:</div>
			<ScopeList className="mb-5" scopes={scopes.map(mcpScope)} />

			<div className="mb-6 grid grid-cols-2 gap-3">
				<div className="grid gap-2">
					<Label htmlFor="mcp-team">Team access</Label>
					<Select value={teamId} onValueChange={setTeamId} disabled={busy}>
						<SelectTrigger id="mcp-team" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All my teams</SelectItem>
							{teams.map(team => (
								<SelectItem key={team.id} value={team.id}>
									{team.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="mcp-expiry">Expires after</Label>
					<Select value={expiresInDays} onValueChange={setExpiresInDays} disabled={busy}>
						<SelectTrigger id="mcp-expiry" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MCP_EXPIRY_DAYS.map(days => (
								<SelectItem key={days} value={days}>
									{days} days
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{decide.isSuccess ? (
				<p className="text-center text-sm text-muted-foreground">Returning you to {clientName}… You can close this tab.</p>
			) : (
				<div className={cn('grid grid-cols-2 gap-2')}>
					<Button variant="outline" disabled={busy} onClick={() => decide.mutate(false)}>
						{decide.isPending && decide.variables === false ? 'Denying…' : 'Deny'}
					</Button>
					<Button disabled={busy} onClick={() => decide.mutate(true)}>
						{decide.isPending && decide.variables === true ? 'Authorizing…' : 'Approve'}
					</Button>
				</div>
			)}
			<p className="mt-4 text-center text-xs text-balance text-muted-foreground">
				Only approve if you started this from {clientName}. You can revoke access anytime under Account → AI access.
			</p>
		</AuthCard>
	);
}
