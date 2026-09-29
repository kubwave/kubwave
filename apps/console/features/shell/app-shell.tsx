'use client';

import { RequireSession } from '@/features/auth/session-guards';
import { CreateTeamDialog } from '@/features/team/create-team-dialog';
import { CommandPalette } from './command-palette';
import { ShellStateProvider, useShellState } from './shell-state';
import { TopBar } from './top-bar';

function ShellDialogs() {
	const { createTeamOpen, setCreateTeamOpen } = useShellState();
	return <CreateTeamDialog open={createTeamOpen} onOpenChange={setCreateTeamOpen} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<ShellStateProvider>
			<RequireSession>
				<div className="flex min-h-svh flex-col">
					<TopBar />
					<main className="flex flex-1 flex-col">{children}</main>
				</div>
				<CommandPalette />
				<ShellDialogs />
			</RequireSession>
		</ShellStateProvider>
	);
}
