'use client';

import { createContext, useContext, useState } from 'react';
import { teams } from '@/lib/mock';

type AppState = {
	teamId: string;
	setTeamId: (id: string) => void;
	envByProject: Record<string, string>;
	setEnv: (projectId: string, envId: string) => void;
	paletteOpen: boolean;
	setPaletteOpen: (open: boolean) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
	const [teamId, setTeamId] = useState(teams[0]!.id);
	const [envByProject, setEnvByProject] = useState<Record<string, string>>({});
	const [paletteOpen, setPaletteOpen] = useState(false);
	const setEnv = (projectId: string, envId: string) => setEnvByProject(m => ({ ...m, [projectId]: envId }));
	return <Ctx.Provider value={{ teamId, setTeamId, envByProject, setEnv, paletteOpen, setPaletteOpen }}>{children}</Ctx.Provider>;
}

export function useAppState() {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error('useAppState outside AppStateProvider');
	return ctx;
}
