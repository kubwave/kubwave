'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { ConfirmProvider } from '@/components/confirm-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionProvider } from '@/features/auth/session-provider';
import type { ServerSession } from '@/lib/api/server-session';

export function Providers({ initialSession, children }: { initialSession: ServerSession | null; children: React.ReactNode }) {
	const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }));
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
			<QueryClientProvider client={queryClient}>
				<SessionProvider initialSession={initialSession}>
					<TooltipProvider delayDuration={300}>
						<ConfirmProvider>{children}</ConfirmProvider>
					</TooltipProvider>
				</SessionProvider>
			</QueryClientProvider>
			<Toaster position="bottom-right" duration={4500} />
		</ThemeProvider>
	);
}
