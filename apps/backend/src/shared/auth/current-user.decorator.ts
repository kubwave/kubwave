import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';

export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
	const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
	if (!request.userId) throw new Error('CurrentUserId used without AuthGuard');
	return request.userId;
});
