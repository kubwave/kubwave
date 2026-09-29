import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/login-form';
import { safeRedirect } from '@/lib/auth/auth-paths';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/auth/login'>) {
	const query = await searchParams;
	return <LoginForm redirectTo={safeRedirect(firstParam(query.redirect))} justReset={firstParam(query.reset) === '1'} />;
}
