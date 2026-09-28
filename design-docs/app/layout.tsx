import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { TopBar } from '@/components/top-bar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { loadPage } from '@/lib/content';
import { flatNav } from '@/lib/nav';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = { title: { default: 'kubwave docs', template: '%s · kubwave docs' }, icons: '/favicon.ico' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	const pages = await Promise.all(flatNav.map(async item => ({ ...item, description: (await loadPage(item.path)).metadata.description ?? '' })));
	return (
		<html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
			<body className="font-sans">
				<ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
					<TooltipProvider delayDuration={300}>
						<TopBar pages={pages} />
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
