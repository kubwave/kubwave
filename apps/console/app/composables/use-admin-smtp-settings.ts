import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { PlatformSettingsSmtpUpdateData } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type SaveSmtpInput = PlatformSettingsSmtpUpdateData['body'];

export async function fetchSmtpSettings(api: ApiClient) {
	return apiData(api.platform.settings.smtp.get());
}

export function smtpSettingsQuery(api: ApiClient) {
	return {
		queryKey: queryKeys.smtp,
		queryFn: () => fetchSmtpSettings(api)
	};
}

export function useSmtpSettings() {
	const api = useApi();
	const queryClient = useQueryClient();
	const toast = useToast();

	const { data: settings } = useQuery(smtpSettingsQuery(api));

	const save = useMutation({
		mutationFn: async (json: SaveSmtpInput) => {
			return apiData(api.platform.settings.smtp.put(json)).catch(() => {
				throw new Error('save_failed');
			});
		},
		onSuccess: updated => {
			queryClient.setQueryData(queryKeys.smtp, updated);
			toast.success('SMTP settings saved');
		},
		onError: () => {
			toast.error('Could not save settings', 'Check the values and try again.');
		}
	});

	const sendTest = useMutation({
		mutationFn: async (to: string) => {
			return apiData(api.platform.settings.smtp.test.post({ to })).catch(() => {
				throw new Error('Request failed');
			});
		},
		onSuccess: (result, to) => {
			if (result.ok) {
				toast.success('Test email sent', `Check the inbox for ${to}.`);
			} else {
				toast.error('Test email failed', result.error ?? 'SMTP error');
			}
		},
		onError: () => toast.error('Test email failed', 'SMTP error')
	});

	return { settings, save, sendTest };
}
