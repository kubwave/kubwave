// Server-only: the dynamic import pulls every page into whichever bundle imports this.
export async function loadPage(path: string) {
	const mod: { default: React.ComponentType; metadata: { title: string; description?: string } } = await import(`@/content/${path.slice(1)}.mdx`);
	return mod;
}
