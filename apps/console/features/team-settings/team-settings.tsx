'use client';

import { GitForkIcon, KeyRoundIcon, SettingsIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { type Section, SettingsLayout } from '@/components/settings-layout';
import { Count, LoadError } from '@/components/settings/parts';
import { Skeleton } from '@/components/ui/skeleton';
import { TeamAvatar } from '@/features/shell/avatars';
import { type TeamSummary, useTeams } from '@/features/team/use-teams';
import { GeneralSection } from './general-section';
import { GitHubIcon } from '@/features/service/service-icon';
import { GiteaSection, GithubSection } from './git-sections';
import { MembersSection } from './members-section';
import { initialTab, tabHref, type TeamSettingsQuery, type TeamSettingsTab } from './model';
import { SshKeysSection } from './ssh-keys-section';
import { useGitCallback } from './use-git-callback';
import { useTeamMembers, useTeamSshKeys } from './use-team-settings';

// Tab and Git-callback state live above the per-team view, so switching teams keeps the tab and never re-redeems a grant.
export function TeamSettings({ query }: { query: TeamSettingsQuery }) {
	const { activeTeam, isPending, isError, refetch } = useTeams();
	const [tab, setTab] = useState(() => initialTab(query));
	useGitCallback(query, activeTeam?.id ?? null);

	// Client-only URL rewrite keeps the tab shareable without a server round trip.
	const changeTab = (next: TeamSettingsTab) => {
		setTab(next);
		window.history.replaceState(null, '', tabHref(next));
	};

	if (!activeTeam)
		return (
			<div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
				{isPending ? (
					<Skeleton className="h-14 w-72" />
				) : isError ? (
					<LoadError what="your teams" onRetry={() => void refetch()} className="rounded-lg border" />
				) : (
					<p className="text-sm text-muted-foreground">No team selected.</p>
				)}
			</div>
		);
	return <TeamSettingsView key={activeTeam.id} team={activeTeam} tab={tab} onTabChange={changeTab} />;
}

function TeamSettingsView({ team, tab, onTabChange }: { team: TeamSummary; tab: TeamSettingsTab; onTabChange: (tab: TeamSettingsTab) => void }) {
	const members = useTeamMembers(team.id);
	const keys = useTeamSshKeys(team.id);
	const isOwner = team.role === 'owner';

	const sections: Section[] = [
		{ id: 'general', label: 'General', icon: SettingsIcon },
		{ id: 'members', label: 'Members', icon: UsersIcon, badge: members.data && <Count n={members.data.length} /> },
		{ id: 'ssh-keys', label: 'SSH keys', icon: KeyRoundIcon, badge: keys.data && <Count n={keys.data.length} /> },
		{ id: 'github', label: 'GitHub', icon: GitHubIcon },
		{ id: 'gitea', label: 'Gitea', icon: GitForkIcon }
	];

	return (
		<div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8">
			<PageHeader
				eyebrow="Team settings"
				title={
					<span className="flex items-center gap-3">
						<TeamAvatar name={team.name} className="size-7 text-sm" />
						{team.name}
					</span>
				}
				description="Members, deploy keys and Git integrations shared by every project in this team."
			/>
			<SettingsLayout sections={sections} active={tab} onChange={id => onTabChange(id as TeamSettingsTab)}>
				{tab === 'general' && <GeneralSection team={team} members={members.data} />}
				{tab === 'members' && (
					<MembersSection
						team={team}
						members={members.data}
						loading={members.isPending}
						onRetry={members.isError ? () => void members.refetch() : undefined}
					/>
				)}
				{tab === 'ssh-keys' && (
					<SshKeysSection
						teamId={team.id}
						isOwner={isOwner}
						keys={keys.data}
						loading={keys.isPending}
						onRetry={keys.isError ? () => void keys.refetch() : undefined}
					/>
				)}
				{tab === 'github' && <GithubSection teamId={team.id} isOwner={isOwner} />}
				{tab === 'gitea' && <GiteaSection teamId={team.id} isOwner={isOwner} />}
			</SettingsLayout>
		</div>
	);
}
