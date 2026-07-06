import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export function githubConnectionQuery(api: ApiClient) {
	return { queryKey: queryKeys.githubConnection, queryFn: () => apiData(api.git.github.get()) };
}

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
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: connection, refetch } = useQuery(githubConnectionQuery(api));

	const connect = useMutation({
		mutationFn: () => apiData(api.git.github.manifest.post()),
		onSuccess: data => {
			if (!data?.postUrl) {
				toast.error('Could not start the GitHub connection', 'The server did not return a redirect URL.');
				return;
			}
			submitManifestForm(data.postUrl, data.manifest);
		},
		onError: (err: unknown) => {
			const detail = (err as { status?: number; error?: string })?.error;
			const status = (err as { status?: number })?.status;
			toast.error('Could not start the GitHub connection', detail ? `${status ?? ''} ${detail}`.trim() : 'Please try again.');
		}
	});

	const disconnect = useMutation({
		mutationFn: () => apiData(api.git.github.delete()),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.githubConnection });
			toast.success('GitHub disconnected');
		},
		onError: () => toast.error('Could not disconnect GitHub')
	});

	return { connection, refetch, connect, disconnect };
}
