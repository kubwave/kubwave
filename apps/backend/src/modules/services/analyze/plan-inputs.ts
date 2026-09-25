import { generateHexKey } from '@kubwave/crypto';
import type { DatabaseEngine } from '@kubwave/db';
import { defaultDatabaseVersion } from '@kubwave/db/database-engines';
import { internalServiceName } from '@kubwave/kube';
import { ApiError } from '../../../shared/errors/api-error.js';
import { createServiceSchema, type CreateServiceInput } from '../services.dto.js';
import type { CreateServicesFromPlanInput, RepoSource } from './analyze.dto.js';

type PlanEnv = CreateServicesFromPlanInput['services'][number]['env'];

export interface PlanTarget {
	id: string;
	engine: DatabaseEngine | null;
	port: number | null;
	// Browser-facing URL (custom or generated domain); null when the service is not publicly reachable.
	publicUrl: string | null;
	// Literal env values of a planned service, so other services can copy them (e.g. a generated MinIO password); null for existing services.
	env: ReadonlyMap<string, string> | null;
}

function invalidPlan(details: unknown): ApiError {
	return new ApiError(400, 'invalid_plan', details);
}

function parseServiceInput(raw: unknown, service: string): CreateServiceInput {
	const parsed = createServiceSchema.safeParse(raw);
	if (!parsed.success) throw invalidPlan({ service, issues: parsed.error.issues });
	return parsed.data;
}

export function normalizeRepoPath(path: string | null): string | undefined {
	const cleaned = (path ?? '')
		.trim()
		.replace(/^\.?\/+/, '')
		.replace(/\/+$/, '');
	return cleaned && cleaned !== '.' ? cleaned : undefined;
}

function sourceFields(source: RepoSource) {
	switch (source.type) {
		case 'public-repo':
			return { repoUrl: source.repoUrl };
		case 'private-repo':
			return { repoUrl: source.repoUrl, sshKeyId: source.sshKeyId };
		case 'github-repo':
		case 'gitea-repo':
			return { installationId: source.installationId, repoFullName: source.repoFullName };
	}
}

// 32 hex chars: strong enough, and within length limits some images enforce (MinIO rejects secret keys over 40 characters).
function fillEnv(env: PlanEnv): PlanEnv {
	return env.map(entry =>
		entry.generate && !entry.value && !entry.reference ? { ...entry, value: generateHexKey(16), secret: true, generate: false } : entry
	);
}

// Generate random secrets once up front, so every service that copies one sees the same value.
export function fillGeneratedSecrets(input: CreateServicesFromPlanInput): CreateServicesFromPlanInput {
	return {
		...input,
		services: input.services.map(service => ({ ...service, env: fillEnv(service.env) })),
		images: input.images.map(image => ({ ...image, env: fillEnv(image.env) }))
	};
}

export function literalEnv(env: PlanEnv): Map<string, string> {
	return new Map(env.filter(entry => !entry.reference && entry.value !== null).map(entry => [entry.key, entry.value!]));
}

export function buildDatabaseInputs(input: CreateServicesFromPlanInput): CreateServiceInput[] {
	return input.databases.map(database =>
		parseServiceInput({ name: database.name, type: database.engine, config: { version: defaultDatabaseVersion(database.engine) } }, database.name)
	);
}

function resolveEnv(
	serviceName: string,
	entries: PlanEnv,
	targets: ReadonlyMap<string, PlanTarget>,
	connectionUri: (serviceName: string) => string
): { env: Array<{ key: string; value: string }>; secrets: Array<{ key: string; value: string }> } {
	const env = new Map<string, string>();
	const secrets = new Map<string, string>();

	for (const entry of entries) {
		let value = entry.value;
		let secret = entry.secret;
		if (entry.reference) {
			const { service: targetName, kind, key } = entry.reference;
			const target = targets.get(targetName);
			if (!target) throw invalidPlan({ service: serviceName, message: `${entry.key} references unknown service "${targetName}".` });
			if (kind === 'connectionUri') {
				if (!target.engine)
					throw invalidPlan({ service: serviceName, message: `${entry.key} needs a connection URI, but "${targetName}" is not a database.` });
				value = connectionUri(targetName);
				secret = true;
			} else if (kind === 'publicUrl') {
				if (!target.publicUrl)
					throw invalidPlan({ service: serviceName, message: `${entry.key} needs the public URL of "${targetName}". Give it a domain.` });
				value = target.publicUrl;
			} else if (kind === 'env') {
				const copied = key ? target.env?.get(key) : undefined;
				if (copied === undefined)
					throw invalidPlan({ service: serviceName, message: `${entry.key} copies ${key ?? '?'} from "${targetName}", which has no such value.` });
				value = copied;
			} else {
				if (target.port == null) throw invalidPlan({ service: serviceName, message: `${entry.key} references "${targetName}", which has no port.` });
				value = `http://${internalServiceName(target.id)}:${target.port}`;
			}
		}
		if (value === null) continue;
		(secret ? secrets : env).set(entry.key, value);
		(secret ? env : secrets).delete(entry.key);
	}

	return { env: [...env].map(([key, value]) => ({ key, value })), secrets: [...secrets].map(([key, value]) => ({ key, value })) };
}

function domainFields(name: string, publicDomain: boolean, domain: string | null, containerPort: number | null) {
	if (domain && containerPort == null) throw invalidPlan({ service: name, message: 'A domain needs a container port.' });
	return {
		defaultDomainEnabled: publicDomain && !domain && containerPort != null,
		...(domain ? { domains: [{ host: domain, port: containerPort }] } : {})
	};
}

// Resolves env references against planned and existing services and validates every service against the regular create schema.
export function buildAppInputs(
	input: CreateServicesFromPlanInput,
	targets: ReadonlyMap<string, PlanTarget>,
	connectionUri: (serviceName: string) => string
): CreateServiceInput[] {
	return input.services.map(service => {
		const dockerfilePath = service.builder === 'dockerfile' ? normalizeRepoPath(service.dockerfilePath) : undefined;
		return parseServiceInput(
			{
				name: service.name,
				type: input.source.type,
				autoDeploy: { enabled: input.autoDeploy },
				config: {
					...sourceFields(input.source),
					branch: input.source.branch,
					rootDirectory: normalizeRepoPath(service.rootDirectory),
					watchPaths: service.watchPaths.map(normalizeRepoPath).filter(path => path !== undefined),
					builder: service.builder,
					...(dockerfilePath ? { dockerfilePath } : {}),
					...(service.buildCommand ? { buildCommand: service.buildCommand } : {}),
					...(service.startCommand ? { startCommand: service.startCommand } : {}),
					containerPort: service.containerPort,
					...domainFields(service.name, service.publicDomain, service.domain, service.containerPort),
					...resolveEnv(service.name, service.env, targets, connectionUri)
				}
			},
			service.name
		);
	});
}

export function buildImageInputs(
	input: CreateServicesFromPlanInput,
	targets: ReadonlyMap<string, PlanTarget>,
	connectionUri: (serviceName: string) => string
): CreateServiceInput[] {
	return input.images.map(image =>
		parseServiceInput(
			{
				name: image.name,
				type: 'docker-image',
				config: {
					image: image.image,
					tag: image.tag,
					containerPort: image.containerPort,
					...(image.args.length ? { args: image.args } : {}),
					volumes: image.volumes,
					...domainFields(image.name, image.publicDomain, image.domain, image.containerPort),
					...resolveEnv(image.name, image.env, targets, connectionUri)
				}
			},
			image.name
		)
	);
}
