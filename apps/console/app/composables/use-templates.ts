import { useQuery } from '@tanstack/vue-query';
import type { TemplatesListResponse } from '@kubwave/api-client';
import type { ApiClient } from '~/utils/api-client';
import { queryKeys } from '~/utils/query-keys';

export type TemplateListItem = TemplatesListResponse[number];

export async function fetchTemplates(api: ApiClient) {
	return apiData(api.templates.get());
}

export function useTemplates() {
	const api = useApi();
	return useQuery({
		queryKey: queryKeys.templates,
		queryFn: () => fetchTemplates(api)
	});
}
