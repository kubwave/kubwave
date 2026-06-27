import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TokenService } from '../../../shared/auth/token.service.js';
import { EnvironmentsService } from '../environments.service.js';
import { environmentIdParamSchema } from '../environments.dto.js';
import { registerFlowLayoutSocket } from './flow-layout.realtime.js';

interface AuthMessage {
	type?: unknown;
	accessToken?: unknown;
}

export function registerFlowLayoutWebSocketRoute(app: NestFastifyApplication): void {
	const fastify = app.getHttpAdapter().getInstance();
	const tokens = app.get(TokenService);
	const environments = app.get(EnvironmentsService);

	fastify.get('/api/environments/:environmentId/flow-layout/ws', { websocket: true }, (socket, request) => {
		const parsed = environmentIdParamSchema.safeParse(request.params);
		if (!parsed.success) {
			socket.close(1008, 'invalid_environment');
			return;
		}

		const environmentId = parsed.data.environmentId;
		let authenticated = false;
		let authInFlight = false;
		let unregister: (() => void) | null = null;
		let authTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
			if (!authenticated) socket.close(1008, 'auth_required');
		}, 10_000);

		const cleanup = () => {
			if (authTimer) {
				clearTimeout(authTimer);
				authTimer = null;
			}
			unregister?.();
			unregister = null;
		};

		socket.on('message', (data: unknown) => {
			if (authenticated || authInFlight) return;

			const raw = messageToString(data);
			if (raw === null) {
				socket.close(1003, 'invalid_message');
				return;
			}

			let message: AuthMessage;
			try {
				message = JSON.parse(raw) as AuthMessage;
			} catch {
				socket.close(1003, 'invalid_message');
				return;
			}

			if (message.type !== 'auth' || typeof message.accessToken !== 'string') {
				socket.close(1008, 'auth_required');
				return;
			}

			authInFlight = true;
			void tokens
				.verifyAccessToken(message.accessToken)
				.then(payload => environments.loadEnvironmentForUser(payload.sub, environmentId))
				.then(() => {
					if (socket.readyState !== 1) return;
					authenticated = true;
					if (authTimer) {
						clearTimeout(authTimer);
						authTimer = null;
					}
					unregister = registerFlowLayoutSocket(environmentId, socket);
					socket.send(JSON.stringify({ type: 'ready' }));
				})
				.catch(() => {
					socket.close(1008, 'unauthorized');
				})
				.finally(() => {
					authInFlight = false;
				});
		});

		socket.on('close', cleanup);
		socket.on('error', cleanup);
	});
}

function messageToString(data: unknown): string | null {
	if (typeof data === 'string') return data;
	if (Buffer.isBuffer(data)) return data.toString('utf8');
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
	if (Array.isArray(data) && data.every(Buffer.isBuffer)) return Buffer.concat(data).toString('utf8');
	return null;
}
