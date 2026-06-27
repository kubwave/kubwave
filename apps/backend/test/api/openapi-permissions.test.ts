import { beforeAll, describe, expect, test } from 'bun:test';

process.env.JWT_SECRET ??= 'test-secret';
process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/test';

type OpenApiOperation = {
	description?: string;
	security?: Array<Record<string, string[]>>;
};

type OpenApiSpec = {
	components?: {
		securitySchemes?: Record<string, unknown>;
	};
	paths: Record<string, Record<string, OpenApiOperation>>;
};

let spec: OpenApiSpec;

// Build the NestJS OpenAPI document; the old per-endpoint permission descriptions aren't carried over, so only the security metadata is asserted.
beforeAll(async () => {
	const { createApiApp } = await import('../../src/app.factory.js');
	const { createOpenApiDocument } = await import('../../src/shared/openapi/openapi.js');
	const app = await createApiApp();
	try {
		spec = createOpenApiDocument(app) as unknown as OpenApiSpec;
	} finally {
		await app.close();
	}
});

function operation(path: string, method: string): OpenApiOperation {
	const op = spec.paths[path]?.[method];
	expect(op).toBeDefined();
	return op!;
}

describe('OpenAPI permission metadata', () => {
	test('registers bearer auth as a reusable security scheme', () => {
		expect(spec.components?.securitySchemes?.bearerAuth).toEqual({
			type: 'http',
			scheme: 'bearer',
			bearerFormat: 'JWT'
		});
	});

	test('marks protected routes with bearer security', () => {
		expect(operation('/api/auth/session', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/platform/users', 'get').security).toEqual([{ bearerAuth: [] }]);
		expect(operation('/api/teams/{teamId}/members', 'post').security).toEqual([{ bearerAuth: [] }]);
	});

	test('leaves public routes without bearer security', () => {
		expect(operation('/api/auth/login', 'post').security).toBeUndefined();
		expect(operation('/api/setup/status', 'get').security).toBeUndefined();
		expect(operation('/api/setup/initialize', 'post').security).toBeUndefined();
		expect(operation('/api/invitations/{id}/validity', 'get').security).toBeUndefined();
	});
});
