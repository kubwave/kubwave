import { beforeAll, describe, expect, test } from 'bun:test';

process.env.JWT_SECRET ??= 'test-secret';
process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/test';

interface OpenApiOperation {
	operationId?: string;
}
interface OpenApiSpec {
	paths: Record<string, Record<string, OpenApiOperation>>;
}
let spec: OpenApiSpec;

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

describe('templates OpenAPI contract', () => {
	test('registers the template routes with stable operation ids', () => {
		expect(spec.paths['/api/templates']?.get?.operationId).toBe('templatesList');
		expect(spec.paths['/api/templates/{templateId}']?.get?.operationId).toBe('templatesGet');
		expect(spec.paths['/api/templates/{templateId}/logo']?.get?.operationId).toBe('templatesLogo');
		expect(spec.paths['/api/environments/{environmentId}/services/from-template']?.post?.operationId).toBe('environmentServicesCreateFromTemplate');
	});
});
