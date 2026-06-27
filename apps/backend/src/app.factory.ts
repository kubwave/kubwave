import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiModule } from './api.module.js';
import { registerFlowLayoutWebSocketRoute } from './modules/environments/flow-layout/flow-layout.websocket.js';
import { configureOpenApi } from './shared/openapi/openapi.js';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter.js';

export async function createApiApp(): Promise<NestFastifyApplication> {
	const app = await NestFactory.create<NestFastifyApplication>(ApiModule, new FastifyAdapter({ logger: false, trustProxy: true }), {
		bufferLogs: true
	});

	await app.register(cookie);
	await app.register(websocket);
	registerFlowLayoutWebSocketRoute(app);

	app.setGlobalPrefix('api');
	app.useGlobalFilters(new ApiExceptionFilter());
	configureOpenApi(app);

	return app;
}
