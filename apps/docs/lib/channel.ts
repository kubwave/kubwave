// Each docs build represents one release line: "latest" (stable tags) or "next" (prereleases),
// baked in at build time via NEXT_PUBLIC_DOCS_CHANNEL (see release.yml).
export type DocsChannel = 'latest' | 'next';

export type ChannelSite = { label: string; caption: string; url: string };

export const channelSites: Record<DocsChannel, ChannelSite> = {
	latest: { label: 'Latest', caption: 'Stable release', url: 'https://docs.kubwave.com' },
	next: { label: 'Next', caption: 'Preview release', url: 'https://docs-next.kubwave.com' }
};

export function resolveDocsChannel(value: string | undefined): DocsChannel {
	return value === 'next' ? 'next' : 'latest';
}

export const docsChannel = resolveDocsChannel(process.env.NEXT_PUBLIC_DOCS_CHANNEL);

// The stable site must not hand readers a `--channel preview` install.
export function buildInstallCommand(channel: DocsChannel): string {
	const command = 'curl -fsSL https://get.kubwave.com | bash';
	return channel === 'next' ? `${command} -s -- --channel preview` : command;
}

export function channelUrl(channel: DocsChannel, path: string): string {
	return `${channelSites[channel].url}${path}`;
}
