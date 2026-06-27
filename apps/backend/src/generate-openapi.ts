import 'reflect-metadata';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

process.env.JWT_SECRET ??= 'openapi-generation-secret';
process.env.DATABASE_URL ??= 'postgres://openapi:openapi@localhost:5432/openapi';

const outputPath = process.argv[2];
if (!outputPath) {
	throw new Error('Usage: bun run openapi:generate -- <output-path>');
}

const { createApiApp } = await import('./app.factory.js');
const { createOpenApiDocument } = await import('./shared/openapi/openapi.js');
const app = await createApiApp();
try {
	const document = createOpenApiDocument(app);
	const resolved = resolve(outputPath);
	await mkdir(dirname(resolved), { recursive: true });
	await writeFile(resolved, `${JSON.stringify(document, null, 2)}\n`);
	console.log(`[backend] wrote OpenAPI document to ${resolved}`);
} finally {
	await app.close();
}
