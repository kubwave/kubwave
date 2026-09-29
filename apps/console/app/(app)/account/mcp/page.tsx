import type { Metadata } from 'next';
import { McpAccessSettings } from '@/features/account/mcp-access';

export const metadata: Metadata = { title: 'AI access (MCP)' };

export default function McpAccessPage() {
	return <McpAccessSettings />;
}
