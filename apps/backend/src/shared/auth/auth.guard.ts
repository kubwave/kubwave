import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, users } from '@kubwave/db';
import { ApiError } from '../errors/api-error.js';
import { TokenService } from './token.service.js';

export interface AuthenticatedRequest extends FastifyRequest {
	userId?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(private readonly tokens: TokenService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const userId = await this.userIdFromRequest(request);
		if (!userId) throw new ApiError(401, 'unauthorized');
		request.userId = userId;
		return true;
	}

	private async userIdFromRequest(request: FastifyRequest): Promise<string | null> {
		const header = request.headers.authorization;
		if (!header?.startsWith('Bearer ')) return null;
		try {
			const payload = await this.tokens.verifyAccessToken(header.slice(7));
			return payload.sub;
		} catch {
			return null;
		}
	}
}

@Injectable()
export class AdminGuard extends AuthGuard {
	override async canActivate(context: ExecutionContext): Promise<boolean> {
		await super.canActivate(context);
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		if (!request.userId) throw new ApiError(401, 'unauthorized');

		const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, request.userId)).limit(1);
		if (!user?.isAdmin) throw new ApiError(403, 'forbidden');
		return true;
	}
}
