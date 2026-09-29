import type { Metadata } from 'next';
import { McpConsent } from '@/features/mcp/mcp-consent';
import { oauthRequestFrom } from '@/lib/mcp';

export const metadata: Metadata = { title: 'Authorize AI client' };

export default async function McpAuthorizePage({ searchParams }: PageProps<'/mcp/authorize'>) {
	return <McpConsent request={oauthRequestFrom(await searchParams)} />;
}
