import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { ApiError } from '../errors/api-error.js';

@Injectable()
export class AuthRateLimitGuard extends ThrottlerGuard {
	protected override async getTracker(req: Record<string, unknown>): Promise<string> {
		const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
		const xffRaw = headers['x-forwarded-for'];
		const xff = Array.isArray(xffRaw) ? xffRaw[0] : xffRaw;
		if (typeof xff === 'string') {
			const first = xff.split(',')[0]?.trim();
			if (first) return first;
		}
		const xriRaw = headers['x-real-ip'];
		const xri = Array.isArray(xriRaw) ? xriRaw[0] : xriRaw;
		if (typeof xri === 'string' && xri.trim()) return xri.trim();
		return (req.ip as string | undefined) ?? 'unknown';
	}

	protected override async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
		const reply = context.switchToHttp().getResponse<FastifyReply>();
		const retryAfter = Math.max(1, Math.ceil(detail.timeToExpire));
		void reply.header('Retry-After', String(retryAfter));
		throw new ApiError(429, 'too_many_login_attempts');
	}
}
