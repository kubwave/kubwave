'use client';

import { apiData } from '@kubwave/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { type GitProvider, gitCallback, initialTab, tabHref, type TeamSettingsQuery } from './model';

type Claim = { provider: GitProvider; teamId: string; grant: string };

const messages: Record<GitProvider, { claimed: string; claimFailed: string; failed: string }> = {
	github: {
		claimed: 'Repository access installed',
		claimFailed: 'Could not finish installing repository access',
		failed: 'Could not install repository access'
	},
	gitea: { claimed: 'Gitea account connected', claimFailed: 'Could not finish connecting Gitea', failed: 'Could not connect Gitea' }
};

async function claimGrant({ provider, teamId, grant }: Claim) {
	const git = getBrowserApi().teams(teamId).git;
	if (provider === 'github') await apiData(git.installations.claim.post({ grant }));
	else await apiData(git.gitea.installations.claim.post({ grant }));
}

// Redeems the grant the backend's Git callback redirected here with, exactly once per page load (not again
// when the team switches), then drops the callback params from the URL. The backend binds only if the
// signed-in user matches the grant, so a phished grant can't bind to someone else's team.
export function useGitCallback(query: TeamSettingsQuery, teamId: string | null) {
	const queryClient = useQueryClient();
	const claim = useMutation({
		mutationFn: claimGrant,
		onSuccess: (_data, { provider, teamId: id }) => {
			toast.success(messages[provider].claimed);
			const keys =
				provider === 'github'
					? [queryKeys.gitInstallations(id), queryKeys.gitConnection(id)]
					: [queryKeys.giteaInstallations(id), queryKeys.giteaTeamConnection(id)];
			return Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey })));
		},
		onError: (_err, { provider }) => toast.error(messages[provider].claimFailed)
	});
	const handled = useRef(false);

	useEffect(() => {
		if (handled.current || !teamId) return;
		handled.current = true;
		const provider = initialTab(query);
		if (provider !== 'github' && provider !== 'gitea') return;
		const callback = gitCallback(provider, query);
		if (!callback) return;
		if (callback.kind === 'claim') claim.mutate({ provider, teamId, grant: callback.grant });
		else
			toast.error(
				callback.kind === 'reconnect'
					? 'This GitHub App must be reconnected by an administrator before repositories can be installed'
					: messages[provider].failed
			);
		window.history.replaceState(null, '', tabHref(provider));
	}, [query, teamId, claim]);
}
