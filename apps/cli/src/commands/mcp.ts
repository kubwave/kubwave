import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { Command } from 'commander';
import type { Readable, Writable } from 'node:stream';
import { getCliVersion } from '~/lib/cli-version.js';

export function resolveMcpUrl(value = process.env.KUBWAVE_URL): URL {
	if (!value?.trim()) throw new Error('Set --url or KUBWAVE_URL to your Kubwave instance URL.');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('The Kubwave URL must be an absolute HTTP or HTTPS URL.');
	}
	const hostname = url.hostname.replace(/\.$/, '');
	const local = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
		throw new Error('The Kubwave URL must use HTTPS; HTTP is allowed only for localhost and loopback addresses.');
	}
	if (url.username || url.password || url.hash || url.search) {
		throw new Error('The Kubwave URL must not contain credentials, a query, or a fragment.');
	}
	url.pathname = url.pathname.replace(/\/+$/, '');
	if (!url.pathname.endsWith('/api/mcp')) url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/mcp`;
	return url;
}

export async function startMcpProxy(options: { url?: string; token?: string; stdin?: Readable; stdout?: Writable } = {}): Promise<StdioServerHandle> {
	const url = resolveMcpUrl(options.url);
	const token = (options.token ?? process.env.KUBWAVE_MCP_TOKEN)?.trim();
	if (!token || /\s/.test(token)) throw new Error('Set KUBWAVE_MCP_TOKEN to a valid MCP token from the Kubwave console.');
	const identity = { name: 'kubwave-cli', version: getCliVersion() };
	const client = new Client(identity, { versionNegotiation: { mode: 'auto' }, enforceStrictCapabilities: true });
	const remote = new StreamableHTTPClientTransport(url, {
		authProvider: { token: async () => token },
		requestInit: { redirect: 'error' }
	});
	const stdio = new StdioServerTransport(options.stdin, options.stdout);
	const reportError = () => process.stderr.write('kubwave mcp: Connection or protocol error. Check the instance URL, token, and connectivity.\n');
	let handle: StdioServerHandle | undefined;
	let closing: Promise<void> | undefined;
	let stopping = false;
	const close = (): Promise<void> => {
		closing ??= Promise.resolve().then(async () => {
			process.off('SIGINT', shutdown);
			process.off('SIGTERM', shutdown);
			await Promise.allSettled([handle?.close(), client.close()]);
		});
		return closing;
	};
	const shutdown = () => {
		stopping = true;
		void close();
	};
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
	client.onerror = reportError;
	client.onclose = () => void close();
	const connected = client.connect(remote);
	handle = serveStdio(
		async () => {
			await connected;
			const server = new Server(identity, { capabilities: { tools: {} }, instructions: client.getInstructions() });
			server.setRequestHandler('tools/list', async (request, ctx) => {
				try {
					return await client.listTools(request.params, { signal: ctx.mcpReq.signal, cacheMode: 'refresh' });
				} catch {
					throw new ProtocolError(ProtocolErrorCode.InternalError, 'Could not list Kubwave tools. Check the connection and MCP token.');
				}
			});
			server.setRequestHandler('tools/call', async (request, ctx) => {
				try {
					return await client.callTool(request.params, { signal: ctx.mcpReq.signal });
				} catch {
					throw new ProtocolError(ProtocolErrorCode.InternalError, 'Kubwave tool request failed. Check the connection and MCP token.');
				}
			});
			return server;
		},
		{ transport: stdio, onerror: reportError }
	);
	const onStdioClose = stdio.onclose;
	stdio.onclose = () => {
		onStdioClose?.();
		if (!closing) shutdown();
	};
	try {
		await connected;
	} catch {
		await close();
		if (!stopping) throw new Error('Could not connect to Kubwave MCP. Check the instance URL, token, and connectivity.');
	}
	return { close };
}

export function registerMcpCommand(parent: Command): void {
	parent
		.command('mcp')
		.description('Connect an AI client to Kubwave over MCP stdio')
		.option('--url <instance>', 'Kubwave instance URL (defaults to KUBWAVE_URL)')
		.action(async (options: { url?: string }) => {
			try {
				await startMcpProxy(options);
			} catch (error) {
				process.stderr.write(`kubwave mcp: ${error instanceof Error ? error.message : 'Could not start the MCP connection.'}\n`);
				process.exitCode = 1;
			}
		});
}
