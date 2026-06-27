import { Injectable } from '@nestjs/common';
import { resolveWorkerRuntimeConfig, type WorkerRuntimeConfig } from './worker-env.js';

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function num(name: string, fallback: number): number {
	const value = process.env[name];
	return value ? Number(value) : fallback;
}

export interface ApiRuntimeConfig {
	port: number;
	jwtSecret: string;
	accessTtlSec: number;
	refreshTtlSec: number;
	cookieSecure: boolean;
	cookieDomain?: string;
	podNamespace: string;
	appVersion: string;
	appBaseUrl: string;
}

// Login throttling. Kept out of the `api` bundle so non-API runtimes (the worker)
// can initialize the global ThrottlerModule without requiring JWT_SECRET.
export interface ThrottlerConfig {
	windowSec: number;
	limit: number;
}

export interface SmtpEnvConfig {
	host?: string;
	port: number;
	secure: boolean;
	user?: string;
	password?: string;
	fromAddress: string;
	fromName: string;
}

@Injectable()
export class BackendConfigService {
	get api(): ApiRuntimeConfig {
		return {
			port: num('API_PORT', num('PORT', 3001)),
			jwtSecret: required('JWT_SECRET'),
			accessTtlSec: num('ACCESS_TTL_SEC', 900),
			refreshTtlSec: num('REFRESH_TTL_SEC', 2_592_000),
			cookieSecure: process.env.NODE_ENV === 'production',
			cookieDomain: process.env.COOKIE_DOMAIN || undefined,
			podNamespace: process.env.POD_NAMESPACE ?? 'kubwave',
			appVersion: process.env.APP_VERSION ?? 'dev',
			appBaseUrl: process.env.APP_BASE_URL ?? 'http://console.localhost'
		};
	}

	get throttler(): ThrottlerConfig {
		return {
			windowSec: num('AUTH_RATE_LIMIT_WINDOW_SEC', 300),
			limit: num('AUTH_RATE_LIMIT', 10)
		};
	}

	get smtp(): SmtpEnvConfig {
		return {
			host: process.env.SMTP_HOST || undefined,
			port: num('SMTP_PORT', 1025),
			secure: process.env.SMTP_SECURE === 'true',
			user: process.env.SMTP_USER || undefined,
			password: process.env.SMTP_PASSWORD || undefined,
			fromAddress: process.env.SMTP_FROM_ADDRESS ?? 'noreply@kubwave.local',
			fromName: process.env.SMTP_FROM_NAME ?? 'kubwave'
		};
	}

	get worker(): WorkerRuntimeConfig {
		return resolveWorkerRuntimeConfig();
	}
}
