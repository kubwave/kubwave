// Per-project selected-environment state (useState keyed by projectId); the page passes initialEnvId to seed, others read/write.
export function useSelectedEnv(projectId: string, initialEnvId?: string | null) {
	const selectedEnvId = useState<string | null>(`selected-env:${projectId}`, () => initialEnvId ?? null);

	function setSelectedEnvId(id: string | null) {
		selectedEnvId.value = id;
	}

	return { selectedEnvId, setSelectedEnvId };
}
