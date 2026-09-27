import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/errors/api-error.js';
import { McpAuthService, type McpPrincipal } from './mcp-auth.service.js';
import { MCP_SCOPES } from './mcp.schemas.js';
import { createMcpTools } from './mcp-tools.js';

const INSTRUCTIONS =
	'Kubwave hosts applications on Kubernetes. Navigate teams > projects > environments > services. ' +
	'Mutating tools require a fresh requestId UUID per operation; reuse it only when retrying. Deploy after changing a service.';

export function registerMcpRoutes(app: NestFastifyApplication): void {
	const fastify = app.getHttpAdapter().getInstance();
	const auth = app.get(McpAuthService);
	const tools = createMcpTools(app);
	const byName = new Map(tools.map(tool => [tool.definition.name, tool]));
	const resourceMetadata = `${auth.issuer}/.well-known/oauth-protected-resource/api/mcp`;

	const server = (principal: McpPrincipal) => {
		const allowed = tools.filter(tool => tool.scopes.every(scope => principal.scopes.includes(scope)));
		const instance = new Server({ name: 'kubwave', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
		instance.setRequestHandler('tools/list', () => ({ tools: allowed.map(tool => tool.definition) }));
		instance.setRequestHandler('tools/call', request => {
			const tool = byName.get(request.params.name);
			if (!tool) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
			return tool.execute(principal, request.params.arguments ?? {});
		});
		return instance;
	};

	const handle = async (request: FastifyRequest, reply: FastifyReply) => {
		const header = request.headers.authorization;
		let principal: McpPrincipal;
		try {
			principal = await auth.authenticate(header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined);
		} catch (error) {
			if (!(error instanceof ApiError)) throw error;
			return reply.code(401).header('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}"`).send({ error: 'unauthorized' });
		}
		const handler = createMcpHandler(() => server(principal));
		reply.hijack();
		try {
			await toNodeHandler(handler)(request.raw, reply.raw, request.body);
		} finally {
			await handler.close();
		}
	};
	fastify.route({ method: ['GET', 'POST', 'DELETE'], url: '/api/mcp', handler: handle });

	const protectedResource = () => ({
		resource: auth.resource,
		authorization_servers: [auth.issuer],
		scopes_supported: [...MCP_SCOPES],
		bearer_methods_supported: ['header']
	});
	fastify.get('/.well-known/oauth-protected-resource', async () => protectedResource());
	fastify.get('/.well-known/oauth-protected-resource/api/mcp', async () => protectedResource());
	fastify.get('/.well-known/oauth-authorization-server', async () => ({
		issuer: auth.issuer,
		authorization_endpoint: `${auth.issuer}/api/mcp/oauth/authorize`,
		token_endpoint: `${auth.issuer}/api/mcp/oauth/token`,
		registration_endpoint: `${auth.issuer}/api/mcp/oauth/register`,
		revocation_endpoint: `${auth.issuer}/api/mcp/oauth/revoke`,
		scopes_supported: [...MCP_SCOPES],
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none']
	}));
}
