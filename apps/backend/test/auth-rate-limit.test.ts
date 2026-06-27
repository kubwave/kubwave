import 'reflect-metadata';
import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AuthRateLimitGuard } from '../src/shared/throttler/auth-rate-limit.guard.js';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter.js';

@Controller('auth')
class StubAuthController {
	@Post('login')
	@HttpCode(200)
	@UseGuards(AuthRateLimitGuard)
	login(): { ok: true } {
		return { ok: true };
	}
}

let app: NestFastifyApplication;

beforeAll(async () => {
	const moduleRef = await Test.createTestingModule({
		imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
		controllers: [StubAuthController],
		providers: [AuthRateLimitGuard]
	}).compile();
	app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
	app.useGlobalFilters(new ApiExceptionFilter());
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
	await app.close();
});

function login(ip: string) {
	return app
		.getHttpAdapter()
		.getInstance()
		.inject({
			method: 'POST',
			url: '/auth/login',
			headers: { 'x-forwarded-for': ip },
			payload: {}
		});
}

describe('auth login rate limit', () => {
	test('429 with too_many_login_attempts after limit exceeded', async () => {
		expect((await login('1.2.3.4')).statusCode).toBe(200);
		expect((await login('1.2.3.4')).statusCode).toBe(200);
		const blocked = await login('1.2.3.4');
		expect(blocked.statusCode).toBe(429);
		expect(blocked.json<{ error: string }>()).toEqual({ error: 'too_many_login_attempts' });
		expect(blocked.headers['retry-after']).toBeDefined();
		expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
	});

	test('tracks per client IP independently', async () => {
		expect((await login('9.9.9.9')).statusCode).toBe(200);
	});
});

describe('auth login rate limit disabled', () => {
	test('a non-positive limit disables throttling (passthrough), like the legacy limiter', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 0 }], skipIf: () => true })],
			controllers: [StubAuthController],
			providers: [AuthRateLimitGuard]
		}).compile();
		const disabled = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
		disabled.useGlobalFilters(new ApiExceptionFilter());
		await disabled.init();
		await disabled.getHttpAdapter().getInstance().ready();

		try {
			for (let i = 0; i < 5; i++) {
				const res = await disabled
					.getHttpAdapter()
					.getInstance()
					.inject({ method: 'POST', url: '/auth/login', headers: { 'x-forwarded-for': '5.5.5.5' }, payload: {} });
				expect(res.statusCode).toBe(200);
			}
		} finally {
			await disabled.close();
		}
	});
});
