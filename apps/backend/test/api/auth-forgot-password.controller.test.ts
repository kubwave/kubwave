import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { CookieService } from '~/shared/cookies/cookie.service';
import { AuthRateLimitGuard } from '~/shared/throttler/auth-rate-limit.guard';
import { ApiExceptionFilter } from '~/shared/errors/api-exception.filter';
import { ApiError } from '~/shared/errors/api-error';

// Mock @kubwave/db before dynamic imports — auth.service and auth.guard both import it at module level
mock.module('@kubwave/db', () => ({
	db: {}, sql: null, users: {}, passwordResetTokens: {}, refreshTokens: {}, teamMembers: {}, teams: {}, settings: {}
}));

const { AuthController } = await import('~/modules/auth/auth.controller');
const { AuthService } = await import('~/modules/auth/auth.service');
const { AuthGuard } = await import('~/shared/auth/auth.guard');

const seen: string[] = [];
const authStub = {
	requestPasswordReset: async (email: string) => { seen.push(email); },
	resetPassword: async () => {},
	checkResetTokenValidity: async () => ({ valid: false })
};

let app: NestFastifyApplication;

beforeAll(async () => {
	const moduleRef = await Test.createTestingModule({
		controllers: [AuthController],
		providers: [
			{ provide: AuthService, useValue: authStub },
			{ provide: CookieService, useValue: {} }
		]
	})
		.overrideGuard(AuthRateLimitGuard)
		.useValue({ canActivate: () => true })
		.overrideGuard(AuthGuard)
		.useValue({ canActivate: () => true })
		.compile();
	app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
	app.useGlobalFilters(new ApiExceptionFilter());
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
	await app.close();
});

function forgot(email: string) {
	return app.getHttpAdapter().getInstance().inject({ method: 'POST', url: '/auth/forgot-password', payload: { email } });
}

describe('forgot-password anti-enumeration', () => {
	test('returns { ok: true } for an unknown email', async () => {
		const res = await forgot('ghost@example.com');
		expect(res.statusCode).toBe(200);
		expect(res.json<{ ok: boolean }>()).toEqual({ ok: true });
	});

	test('returns the identical response for a known email', async () => {
		const res = await forgot('admin@kubwave.local');
		expect(res.statusCode).toBe(200);
		expect(res.json<{ ok: boolean }>()).toEqual({ ok: true });
	});

	test('forwards the email to the service', async () => {
		await forgot('someone@x.test');
		expect(seen).toContain('someone@x.test');
	});

	test('returns { ok: true } even when the service throws', async () => {
		const original = authStub.requestPasswordReset;
		authStub.requestPasswordReset = async () => { throw new Error('db error'); };
		try {
			const res = await forgot('error@example.com');
			expect(res.statusCode).toBe(200);
			expect(res.json<{ ok: boolean }>()).toEqual({ ok: true });
		} finally {
			authStub.requestPasswordReset = original;
		}
	});
});

describe('reset-password endpoint', () => {
	test('POST /auth/reset-password with valid body returns { ok: true }', async () => {
		const res = await app.getHttpAdapter().getInstance().inject({
			method: 'POST',
			url: '/auth/reset-password',
			payload: { token: 'tok', password: 'a-valid-password-12' }
		});
		expect(res.statusCode).toBe(200);
		expect(res.json<{ ok: boolean }>()).toEqual({ ok: true });
	});

	test('POST /auth/reset-password when resetPassword rejects returns error response', async () => {
		const original = authStub.resetPassword;
		authStub.resetPassword = async () => { throw new ApiError(400, 'invalid_reset_token'); };
		try {
			const res = await app.getHttpAdapter().getInstance().inject({
				method: 'POST',
				url: '/auth/reset-password',
				payload: { token: 'tok', password: 'a-valid-password-12' }
			});
			expect(res.statusCode).toBe(400);
			expect(res.json<{ error: string }>()).toEqual({ error: 'invalid_reset_token' });
		} finally {
			authStub.resetPassword = original;
		}
	});
});

describe('reset-password validity endpoint', () => {
	test('GET /auth/reset-password/:token/validity returns { valid: true } when token is valid', async () => {
		const original = authStub.checkResetTokenValidity;
		authStub.checkResetTokenValidity = async () => ({ valid: true });
		try {
			const res = await app.getHttpAdapter().getInstance().inject({
				method: 'GET',
				url: '/auth/reset-password/some-token/validity'
			});
			expect(res.statusCode).toBe(200);
			expect(res.json<{ valid: boolean }>()).toEqual({ valid: true });
		} finally {
			authStub.checkResetTokenValidity = original;
		}
	});
});
