'use client';

import { apiData, apiResult } from '@kubwave/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getBrowserApi } from '@/lib/api/browser-api';
import type { ServerSession } from '@/lib/api/server-session';
import type { SessionUser } from '@/lib/api/types';
import { getAccessToken, onSessionLost, refreshAccessToken, setAccessToken } from '@/lib/auth/token-store';

export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';

type Session = {
	user: SessionUser | null;
	status: SessionStatus;
	signIn: (accessToken: string) => Promise<SessionUser>;
	signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

// Loads the user behind the refresh cookie, for pages the server rendered without a session.
async function restoreSession(): Promise<SessionUser | null> {
	const token = getAccessToken() ?? (await refreshAccessToken());
	if (!token) return null;
	const { data } = await apiResult(getBrowserApi().auth.session.get());
	return data?.user ?? null;
}

export function SessionProvider({ initialSession, children }: { initialSession: ServerSession | null; children: React.ReactNode }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	// Seed the token during the first render, before any child query runs. Browser only: on the
	// server the token store is module state shared by all requests.
	const [user, setUser] = useState(() => {
		if (initialSession && typeof window !== 'undefined') setAccessToken(initialSession.accessToken);
		return initialSession?.user ?? null;
	});
	const [restored, setRestored] = useState(initialSession !== null);

	useEffect(() => {
		if (restored) return;
		let active = true;
		void restoreSession().then(restoredUser => {
			if (!active) return;
			setUser(restoredUser);
			setRestored(true);
		});
		return () => {
			active = false;
		};
	}, [restored]);

	// A refresh cookie the API rejects mid-session (expired, revoked) signs the UI out; RequireSession then redirects to login.
	useEffect(
		() =>
			onSessionLost(() => {
				setUser(null);
				setRestored(true);
				queryClient.clear();
			}),
		[queryClient]
	);

	const signIn = useCallback(async (accessToken: string) => {
		setAccessToken(accessToken);
		const { user: signedIn } = await apiData(getBrowserApi().auth.session.get());
		setUser(signedIn);
		setRestored(true);
		return signedIn;
	}, []);

	const signOut = useCallback(async () => {
		await apiResult(getBrowserApi().auth.logout.post());
		setAccessToken(null);
		setUser(null);
		// The next user must never see the previous user's cached data.
		queryClient.clear();
		router.replace('/auth/login');
	}, [queryClient, router]);

	const status: SessionStatus = user ? 'signed-in' : restored ? 'signed-out' : 'loading';
	const value = useMemo(() => ({ user, status, signIn, signOut }), [user, status, signIn, signOut]);
	return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
	const session = useContext(SessionContext);
	if (!session) throw new Error('useSession must be used inside <SessionProvider>');
	return session;
}
