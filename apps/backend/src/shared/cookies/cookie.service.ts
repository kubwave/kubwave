import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BackendConfigService } from '../config/backend-config.service.js';

const REFRESH_COOKIE = 'refresh_token';
const ACTIVE_TEAM_COOKIE = 'active_team';

type CookieRequest = FastifyRequest & { cookies?: Record<string, string | undefined> };

@Injectable()
export class CookieService {
	constructor(private readonly config: BackendConfigService) {}

	getRefreshToken(request: CookieRequest): string | undefined {
		return request.cookies?.[REFRESH_COOKIE];
	}

	getActiveTeam(request: CookieRequest): string | undefined {
		return request.cookies?.[ACTIVE_TEAM_COOKIE];
	}

	setRefreshToken(reply: FastifyReply, token: string): void {
		reply.setCookie(REFRESH_COOKIE, token, this.cookieOptions());
	}

	clearRefreshToken(reply: FastifyReply): void {
		reply.clearCookie(REFRESH_COOKIE, { path: '/', domain: this.config.api.cookieDomain });
	}

	setActiveTeam(reply: FastifyReply, teamId: string): void {
		reply.setCookie(ACTIVE_TEAM_COOKIE, teamId, this.cookieOptions());
	}

	clearActiveTeam(reply: FastifyReply): void {
		reply.clearCookie(ACTIVE_TEAM_COOKIE, { path: '/', domain: this.config.api.cookieDomain });
	}

	private cookieOptions() {
		return {
			httpOnly: true,
			secure: this.config.api.cookieSecure,
			sameSite: 'lax' as const,
			path: '/',
			maxAge: this.config.api.refreshTtlSec,
			domain: this.config.api.cookieDomain
		};
	}
}
