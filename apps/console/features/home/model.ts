export type ProjectSort = 'recent' | 'name';

type Searchable = { name: string; description: string; updatedAt: string };

export function visibleProjects<T extends Searchable>(projects: readonly T[], query: string, sort: ProjectSort): T[] {
	const needle = query.trim().toLowerCase();
	const matches = projects.filter(
		project => !needle || project.name.toLowerCase().includes(needle) || project.description.toLowerCase().includes(needle)
	);
	if (sort === 'name') return [...matches].sort((a, b) => a.name.localeCompare(b.name));
	return [...matches].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
