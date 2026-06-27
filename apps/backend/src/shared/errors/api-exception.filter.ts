import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiError } from './api-error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
	catch(error: unknown, host: ArgumentsHost): void {
		const reply = host.switchToHttp().getResponse<FastifyReply>();

		if (error instanceof ApiError) {
			void reply.status(error.status).send(error.details === undefined ? { error: error.code } : { error: error.code, details: error.details });
			return;
		}

		if (error instanceof HttpException) {
			// Map framework exceptions (e.g. 404 unmatched route, malformed body) to our error
			// envelope without echoing Nest's internal message or the request method+path.
			const status = error.getStatus();
			void reply.status(status).send({ error: status === 400 ? 'validation_error' : 'http_error' });
			return;
		}

		console.error('[backend:api] unexpected error', error);
		void reply.status(500).send({ error: 'internal_error' });
	}
}
