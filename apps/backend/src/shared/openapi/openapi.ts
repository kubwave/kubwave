import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const operationKeys = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

type ParameterLocation = 'query' | 'header' | 'path' | 'cookie';
type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;
type PathItemObject = OpenAPIObject['paths'][string];
type OperationParameter = NonNullable<OperationObject['parameters']>[number];
type ParameterObject = Extract<OperationParameter, { name: string }>;

export function createOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
	const config = new DocumentBuilder()
		.setTitle('kubwave API')
		.setVersion(process.env.APP_VERSION ?? 'dev')
		.addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearerAuth')
		.build();

	const document = SwaggerModule.createDocument(app, config, {
		operationIdFactory: (_controllerKey, methodKey) => methodKey
	});

	addMissingPathParameters(document);
	return document;
}

function addMissingPathParameters(document: OpenAPIObject): void {
	for (const [path, pathItem] of Object.entries(document.paths)) {
		const paramNames = Array.from(path.matchAll(/\{([^}]+)\}/g), match => match[1]).filter((name): name is string => Boolean(name));
		if (paramNames.length === 0) continue;

		for (const key of operationKeys) {
			const operation = pathItem[key];
			if (!operation) continue;
			addMissingOperationPathParameters(operation, pathItem, paramNames);
		}
	}
}

function addMissingOperationPathParameters(operation: OperationObject, pathItem: PathItemObject, paramNames: Array<string>): void {
	const inherited = pathItem.parameters ?? [];
	const own = operation.parameters ?? [];
	const parameters = [...inherited, ...own];
	const missing = paramNames.filter(name => !parameters.some(parameter => isParameterNamed(parameter, name, 'path')));
	if (missing.length === 0) return;

	operation.parameters = [
		...own,
		...missing.map(
			(name): ParameterObject => ({
				name,
				in: 'path',
				required: true,
				schema: { type: 'string' }
			})
		)
	];
}

function isParameterNamed(parameter: OperationParameter, name: string, location: ParameterLocation): boolean {
	return 'name' in parameter && parameter.name === name && parameter.in === location;
}

export function configureOpenApi(app: NestFastifyApplication): void {
	const document = createOpenApiDocument(app);

	app.getHttpAdapter().get('/api/openapi.json', (_request, reply) => {
		void reply.send(document);
	});

	SwaggerModule.setup('/api/docs', app, document, {
		swaggerOptions: { persistAuthorization: true },
		customSiteTitle: 'kubwave API docs'
	});
}
