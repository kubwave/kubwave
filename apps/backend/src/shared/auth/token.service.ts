import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { BackendConfigService } from '../config/backend-config.service.js';

export interface AccessTokenPayload {
	sub: string;
}

@Injectable()
export class TokenService {
	constructor(private readonly config: BackendConfigService) {}

	async signAccessToken(userId: string): Promise<string> {
		const secret = new TextEncoder().encode(this.config.api.jwtSecret);
		return new SignJWT({ sub: userId }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(`${this.config.api.accessTtlSec}s`).sign(secret);
	}

	async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
		const secret = new TextEncoder().encode(this.config.api.jwtSecret);
		const { payload } = await jwtVerify(token, secret);
		if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') throw new Error('invalid token payload');
		return { sub: payload.sub };
	}

	generateRefreshToken(): string {
		return randomBytes(32).toString('base64url');
	}

	hashRefreshToken(token: string): string {
		return createHash('sha256').update(token).digest('hex');
	}
}
