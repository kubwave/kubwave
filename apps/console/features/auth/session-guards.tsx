'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { loginPath } from '@/lib/auth/auth-paths';
import { useSession } from './session-provider';

// Full page loads are guarded by the proxy; this covers client-side navigation and expired sessions.
export function RequireSession({ children }: { children: React.ReactNode }) {
	const { status } = useSession();
	const router = useRouter();
	useEffect(() => {
		if (status === 'signed-out') router.replace(loginPath(window.location.pathname + window.location.search));
	}, [status, router]);
	// Without a session the pages' queries would only collect 401s.
	return status === 'signed-in' ? children : null;
}

// The API enforces admin rights; this only keeps non-admins off pages they cannot use.
export function RequireAdmin({ children }: { children: React.ReactNode }) {
	const { user } = useSession();
	const router = useRouter();
	useEffect(() => {
		if (user && !user.isAdmin) router.replace('/');
	}, [user, router]);
	return user?.isAdmin ? children : null;
}
