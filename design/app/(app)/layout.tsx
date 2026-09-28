import { AppStateProvider } from '@/components/shell/app-state';
import { CommandPalette } from '@/components/shell/command-palette';
import { TopBar } from '@/components/shell/top-bar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
	return (
		<AppStateProvider>
			<div className="flex min-h-svh flex-col">
				<TopBar />
				<main className="flex flex-1 flex-col">{children}</main>
			</div>
			<CommandPalette />
		</AppStateProvider>
	);
}
