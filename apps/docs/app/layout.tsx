import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { TopBar } from '@/components/top-bar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { channelSites } from '@/lib/channel';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
	metadataBase: new URL(channelSites.latest.url),
	title: { default: 'kubwave docs', template: '%s · kubwave docs' },
	description: 'Documentation for kubwave, the open-source, self-hosted PaaS for Kubernetes.',
	icons: { icon: '/favicon.ico', apple: '/logo.png' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
			<body className="font-sans">
				<ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
					<TooltipProvider delayDuration={300}>
						<TopBar />
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
