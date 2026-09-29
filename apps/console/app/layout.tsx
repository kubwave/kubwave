import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import { getServerSession } from '@/lib/api/server-session';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
	title: { default: 'kubwave', template: '%s · kubwave' },
	description: 'Self-hosted kubwave control plane',
	icons: { icon: '/favicon.ico', apple: '/logo.png' }
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	const session = await getServerSession();
	return (
		<html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
			<body className="font-sans">
				<Providers initialSession={session}>{children}</Providers>
			</body>
		</html>
	);
}
