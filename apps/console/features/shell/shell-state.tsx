'use client';

import { createContext, useContext, useMemo, useState } from 'react';

type ShellState = {
	paletteOpen: boolean;
	setPaletteOpen: (open: boolean) => void;
	createTeamOpen: boolean;
	setCreateTeamOpen: (open: boolean) => void;
};

const ShellContext = createContext<ShellState | null>(null);

// UI state shared by the top bar, the command palette and the dialogs they open.
export function ShellStateProvider({ children }: { children: React.ReactNode }) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [createTeamOpen, setCreateTeamOpen] = useState(false);
	const value = useMemo(() => ({ paletteOpen, setPaletteOpen, createTeamOpen, setCreateTeamOpen }), [paletteOpen, createTeamOpen]);
	return <ShellContext value={value}>{children}</ShellContext>;
}

export function useShellState(): ShellState {
	const state = useContext(ShellContext);
	if (!state) throw new Error('useShellState must be used inside <ShellStateProvider>');
	return state;
}
