'use client';

import { apiData, type ConnectGiteaDto } from '@kubwave/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getBrowserApi } from '@/lib/api/browser-api';
import { queryKeys } from '@/lib/api/query-keys';
import { giteaErrorMessage } from './model';

// A native form POST (not fetch) so the browser navigates to GitHub's app-creation page carrying the manifest.
function submitManifestForm(postUrl: string, manifest: string) {
	const form = document.createElement('form');
	form.method = 'POST';
	form.action = postUrl;
	const input = document.createElement('input');
	input.type = 'hidden';
	input.name = 'manifest';
	input.value = manifest;
	form.appendChild(input);
	document.body.appendChild(form);
	form.submit();
}

export function useGithubConnection() {
	const queryClient = useQueryClient();
	const connection = useQuery({ queryKey: queryKeys.githubConnection, queryFn: () => apiData(getBrowserApi().git.github.get()) });
	const connect = useMutation({
		mutationFn: () => apiData(getBrowserApi().git.github.manifest.post()),
		onSuccess: ({ postUrl, manifest }) => {
			if (postUrl) submitManifestForm(postUrl, manifest);
			else toast.error('Could not start the GitHub connection', { description: 'The server did not return a redirect URL.' });
		},
		onError: err => {
			const { status, error } = err as { status?: number; error?: string };
			toast.error('Could not start the GitHub connection', { description: error ? `${status ?? ''} ${error}`.trim() : 'Please try again.' });
		}
	});
	const disconnect = useMutation({
		mutationFn: () => apiData(getBrowserApi().git.github.delete()),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.githubConnection });
			toast.success('GitHub disconnected');
		},
		onError: () => toast.error('Could not disconnect GitHub')
	});
	return { connection, connect, disconnect };
}

export function useGiteaConnection() {
	const queryClient = useQueryClient();
	const connection = useQuery({ queryKey: queryKeys.giteaConnection, queryFn: () => apiData(getBrowserApi().git.gitea.get()) });
	const connect = useMutation({
		mutationFn: (body: ConnectGiteaDto) => apiData(getBrowserApi().git.gitea.post(body)),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.giteaConnection });
			toast.success('Gitea connected', { description: 'Teams can now authorize access in team settings.' });
		},
		onError: err => toast.error('Could not connect Gitea', { description: giteaErrorMessage(err) })
	});
	const disconnect = useMutation({
		mutationFn: () => apiData(getBrowserApi().git.gitea.delete()),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.giteaConnection });
			toast.success('Gitea disconnected');
		},
		onError: () => toast.error('Could not disconnect Gitea')
	});
	return { connection, connect, disconnect };
}
