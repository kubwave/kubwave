import { apiResult } from '@kubwave/api-client';
import { headers } from 'next/headers';
import { ACCESS_TOKEN_HEADER } from '@/lib/auth/request-token';
import type { SessionUser } from './types';
import { getServerApi } from './server-api';

export type ServerSession = { user: SessionUser; accessToken: string };

// The signed-in user plus the token the proxy just minted, for a flash-free first render. The token
// is handed to the browser's in-memory store (never a cookie or storage), which saves a second
// refresh-cookie rotation per page load. Null on client navigations and when signed out.
export async function getServerSession(): Promise<ServerSession | null> {
	const accessToken = (await headers()).get(ACCESS_TOKEN_HEADER);
	const api = await getServerApi();
	if (!accessToken || !api) return null;
	const { data } = await apiResult(api.auth.session.get());
	return data ? { user: data.user, accessToken } : null;
}
