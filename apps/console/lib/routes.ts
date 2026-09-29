// URLs the console links to. Environment, open service and its panel tab/settings section live in
// the query so they survive a reload and can be shared.
export function projectHref(projectId: string, selection: { env?: string; service?: string; tab?: string; section?: string } = {}): string {
	const query = new URLSearchParams();
	if (selection.env) query.set('env', selection.env);
	if (selection.service) query.set('service', selection.service);
	if (selection.tab) query.set('tab', selection.tab);
	if (selection.section) query.set('section', selection.section);
	const search = query.toString();
	return `/team/projects/${projectId}${search ? `?${search}` : ''}`;
}

export function projectSettingsHref(projectId: string): string {
	return `/team/projects/${projectId}/settings`;
}

type EnvironmentLike = { id: string; kind: 'persistent' | 'preview' };

// The environment a project view shows: the one in the URL, else the first persistent one.
export function resolveEnvironment<T extends EnvironmentLike>(environments: readonly T[], requestedId: string | undefined): T | undefined {
	return (
		environments.find(environment => environment.id === requestedId) ??
		environments.find(environment => environment.kind === 'persistent') ??
		environments[0]
	);
}
