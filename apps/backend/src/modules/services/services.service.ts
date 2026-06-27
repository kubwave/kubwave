import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
	DATABASE_ENGINE_CATALOG,
	DEFAULT_DATABASE_NAME,
	DEFAULT_DATABASE_USERNAME,
	DEFAULT_DOMAIN_RUNTIME_KEY,
	DEFAULT_DOMAIN_SETTINGS_KEY,
	buildDefaultDomainForService,
	databaseConnectionUri,
	db,
	environments,
	isAllowedDatabaseVersion,
	isDatabaseEngine,
	projects,
	resolveDefaultDomainRuntime,
	resolveDefaultDomainSettings,
	services,
	sshKeys,
	teamMembers
} from '@kubwave/db';
import type { DatabaseServiceConfig, ServiceConfig, ServiceType } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { internalServiceName, parseMemoryToBytes } from '@kubwave/kube';
import { EnvironmentsService } from '../environments/environments.service.js';
import { SettingsService } from '../../shared/settings/settings.service.js';
import {
	buildStoredConfig,
	buildStoredDatabaseConfig,
	buildStoredDockerfileConfig,
	buildStoredPrivateRepoConfig,
	buildStoredPublicRepoConfig,
	normalizeDockerConfig,
	toConfigView
} from './services.config.js';
import type { AutoDeployInput, CreateComposeServicesInput, CreateServiceInput, UpdateServiceInput } from './services.dto.js';
import { ComposeParseError } from './compose/compose.errors.js';
import { parseComposeServices } from './compose/compose.parser.js';
import { composeReferenceIssues, rewriteComposeServiceReferences } from './compose/compose.references.js';
import {
	ComposeImportError,
	InvalidDatabaseVersionError,
	NotADatabaseServiceError,
	ServiceConfigTypeMismatchError,
	ServiceNameTakenError,
	ServiceNotFoundError,
	SshKeyNotAvailableError,
	VolumeShrinkError
} from './services.errors.js';
import type { DefaultDomainContext, ServiceConnectionView, ServiceRow, ServiceView } from './services.types.js';

function isRepoType(type: ServiceType): boolean {
	return type === 'public-repo' || type === 'private-repo';
}

function autoDeployColumns(
	type: ServiceType,
	input: AutoDeployInput | undefined,
	now: Date
): Partial<Pick<typeof services.$inferInsert, 'autoDeployEnabled' | 'nextPollAt' | 'lastPollError'>> {
	if (!input || !isRepoType(type)) return {};
	if (input.enabled) return { autoDeployEnabled: true, nextPollAt: now };
	return { autoDeployEnabled: false, nextPollAt: null, lastPollError: null };
}

function trimDescription(description?: string): string {
	return description?.trim() ?? '';
}

function resolveDefaultUrl(ctx: DefaultDomainContext, row: { id: string; name: string; config: ServiceConfig }): string | null {
	if (row.config.defaultDomainEnabled !== true) return null;
	if (row.config.containerPort == null) return null;
	if (row.config.domains.length > 0) return null;

	const host = buildDefaultDomainForService(ctx.settings, ctx.runtime, { serviceId: row.id, serviceName: row.name });
	if (!host) return null;

	return `${ctx.runtime.tls ? 'https' : 'http'}://${host}`;
}

function toServiceView(row: ServiceRow, defaultDomain: DefaultDomainContext): ServiceView {
	const config = toConfigView(row.config);
	const hasInternalService = config.containerPort != null || config.domains.length > 0;

	return {
		id: row.id,
		environmentId: row.environmentId,
		name: row.name,
		description: row.description,
		type: row.type,
		config,
		autoDeploy: {
			enabled: row.autoDeployEnabled,
			lastPolledCommit: row.lastPolledCommit,
			lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
			nextPollAt: row.nextPollAt?.toISOString() ?? null,
			lastPollError: row.lastPollError
		},
		internalDomain: hasInternalService ? internalServiceName(row.id) : null,
		defaultUrl: resolveDefaultUrl(defaultDomain, row),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

@Injectable()
export class ServicesService {
	constructor(
		private readonly environmentsService: EnvironmentsService,
		private readonly settings: SettingsService
	) {}

	async listServicesForEnvironment(actingUserId: string, environmentId: string): Promise<ServiceView[]> {
		const environment = await this.environmentsService.loadEnvironmentForUser(actingUserId, environmentId);
		const rows = await db
			.select()
			.from(services)
			.where(eq(services.environmentId, environment.id))
			.orderBy(asc(services.createdAt), asc(services.id));
		const defaultDomain = await this.loadDefaultDomainContext();

		return rows.map(row => toServiceView(row, defaultDomain));
	}

	async createService(actingUserId: string, environmentId: string, input: CreateServiceInput, id?: string): Promise<ServiceView> {
		const environment = await this.environmentsService.loadEnvironmentForUser(actingUserId, environmentId);
		const name = input.name.trim();

		if (await this.serviceNameTaken(environment.id, name)) {
			throw new ServiceNameTakenError();
		}

		if (input.type === 'private-repo') {
			await this.assertSshKeyForTeam(environment.teamId, input.config.sshKeyId);
		}

		const config: ServiceConfig = (() => {
			switch (input.type) {
				case 'dockerfile':
					return buildStoredDockerfileConfig(input.config, []);
				case 'public-repo':
					return buildStoredPublicRepoConfig(input.config, []);
				case 'private-repo':
					return buildStoredPrivateRepoConfig(input.config, []);
				case 'postgres':
				case 'mysql':
				case 'mariadb':
				case 'mongodb':
					return buildStoredDatabaseConfig(input.type, input.config, null);
				default:
					return buildStoredConfig(input.config, []);
			}
		})();

		const [service] = await db
			.insert(services)
			.values({
				// Optional caller-provided id (template instantiation pre-generates ids so cross-references resolve in any order).
				...(id ? { id } : {}),
				environmentId: environment.id,
				name,
				description: trimDescription(input.description),
				type: input.type,
				config,
				...autoDeployColumns(input.type, 'autoDeploy' in input ? input.autoDeploy : undefined, new Date())
			})
			.returning();

		if (!service) throw new Error('failed to create service');

		return toServiceView(service, await this.loadDefaultDomainContext());
	}

	async createServicesFromCompose(actingUserId: string, environmentId: string, input: CreateComposeServicesInput): Promise<ServiceView[]> {
		let parsed: ReturnType<typeof parseComposeServices>;
		try {
			parsed = parseComposeServices(input.compose);
		} catch (err) {
			if (err instanceof ComposeParseError) throw new ComposeImportError(400, err.issues);
			throw err;
		}

		const environment = await this.environmentsService.loadEnvironmentForUser(actingUserId, environmentId);
		const names = parsed.map(service => service.name);
		const referenceIssues = composeReferenceIssues(parsed);
		if (referenceIssues.length > 0) throw new ComposeImportError(400, referenceIssues);

		const serviceIdsByName = new Map(parsed.map(service => [service.name, randomUUID()]));
		const servicesToCreate = rewriteComposeServiceReferences(parsed, serviceIdsByName);

		const rows = await db.transaction(async tx => {
			const existing = await tx
				.select({ name: services.name })
				.from(services)
				.where(and(eq(services.environmentId, environment.id), inArray(services.name, names)));

			if (existing.length > 0) {
				const existingNames = new Set(existing.map(row => row.name));
				const conflicts = names.filter(name => existingNames.has(name));
				throw new ComposeImportError(409, [`Service names already exist in this environment: ${conflicts.join(', ')}.`]);
			}

			return tx
				.insert(services)
				.values(
					servicesToCreate.map(service => ({
						id: serviceIdsByName.get(service.name)!,
						environmentId: environment.id,
						name: service.name,
						description: '',
						type: 'docker-image' as const,
						config: normalizeDockerConfig(service.config)
					}))
				)
				.returning();
		});

		const defaultDomain = await this.loadDefaultDomainContext();
		return rows.map(row => toServiceView(row, defaultDomain));
	}

	async getService(actingUserId: string, serviceId: string): Promise<ServiceView> {
		return toServiceView(await this.loadServiceForUser(actingUserId, serviceId), await this.loadDefaultDomainContext());
	}

	async getServiceConnection(actingUserId: string, serviceId: string): Promise<ServiceConnectionView> {
		const service = await this.loadServiceForUser(actingUserId, serviceId);
		if (!isDatabaseEngine(service.type)) throw new NotADatabaseServiceError();

		const config = service.config as DatabaseServiceConfig;
		const { port } = DATABASE_ENGINE_CATALOG[service.type];
		const host = internalServiceName(service.id);
		const username = config.username?.trim() || DEFAULT_DATABASE_USERNAME;
		const database = config.database?.trim() || DEFAULT_DATABASE_NAME;
		const password = decryptSecret(config.password);

		return {
			engine: service.type,
			host,
			port,
			username,
			database,
			password,
			uri: databaseConnectionUri({ engine: service.type, host, port, username, password, database })
		};
	}

	async updateService(actingUserId: string, serviceId: string, input: UpdateServiceInput): Promise<ServiceView> {
		const service = await this.loadServiceForUser(actingUserId, serviceId);
		const now = new Date();
		const values: {
			name?: string;
			description?: string;
			config?: ServiceConfig;
			updatedAt: Date;
		} & ReturnType<typeof autoDeployColumns> = { updatedAt: now, ...autoDeployColumns(service.type, input.autoDeploy, now) };

		if (input.name !== undefined) {
			const name = input.name.trim();

			if (name !== service.name && (await this.serviceNameTaken(service.environmentId, name, service.id))) {
				throw new ServiceNameTakenError();
			}

			values.name = name;
		}

		if (input.description !== undefined) {
			values.description = input.description.trim();
		}

		if (input.config !== undefined) {
			const liveSizes = new Map((service.config.volumes ?? []).map(volume => [volume.name, volume.size]));
			const incomingVolumes = 'volumes' in input.config ? input.config.volumes : [];

			for (const volume of incomingVolumes ?? []) {
				const liveSize = liveSizes.get(volume.name.trim());
				if (!liveSize) continue;

				const liveBytes = parseMemoryToBytes(liveSize);
				const nextBytes = parseMemoryToBytes(volume.size);

				if (liveBytes != null && nextBytes != null && nextBytes < liveBytes) {
					throw new VolumeShrinkError(volume.name.trim());
				}
			}

			const incoming = input.config;

			if (service.type === 'dockerfile') {
				if (!('dockerfile' in incoming)) throw new ServiceConfigTypeMismatchError();
				values.config = buildStoredDockerfileConfig(incoming, service.config.secrets);
			} else if (service.type === 'private-repo') {
				if (!('sshKeyId' in incoming)) throw new ServiceConfigTypeMismatchError();
				await this.assertSshKeyForTeam(service.teamId, incoming.sshKeyId);
				values.config = buildStoredPrivateRepoConfig(incoming, service.config.secrets);
			} else if (service.type === 'public-repo') {
				if (!('repoUrl' in incoming) || 'sshKeyId' in incoming) throw new ServiceConfigTypeMismatchError();
				values.config = buildStoredPublicRepoConfig(incoming, service.config.secrets);
			} else if (isDatabaseEngine(service.type)) {
				if (!('version' in incoming) || !('storage' in incoming)) throw new ServiceConfigTypeMismatchError();
				if (!isAllowedDatabaseVersion(service.type, incoming.version)) throw new InvalidDatabaseVersionError(incoming.version);

				const stored = service.config as DatabaseServiceConfig;
				const liveBytes = parseMemoryToBytes(stored.storage?.size);
				const nextBytes = parseMemoryToBytes(incoming.storage.size);
				if (liveBytes != null && nextBytes != null && nextBytes < liveBytes) throw new VolumeShrinkError('storage');

				values.config = buildStoredDatabaseConfig(service.type, incoming, { secrets: stored.secrets, password: stored.password });
			} else {
				if (!('image' in incoming)) throw new ServiceConfigTypeMismatchError();
				values.config = buildStoredConfig(incoming, service.config.secrets);
			}
		}

		const [updated] = await db.update(services).set(values).where(eq(services.id, service.id)).returning();
		if (!updated) throw new ServiceNotFoundError();

		return toServiceView(updated, await this.loadDefaultDomainContext());
	}

	async deleteService(actingUserId: string, serviceId: string): Promise<void> {
		const service = await this.loadServiceForUser(actingUserId, serviceId);
		await db.delete(services).where(eq(services.id, service.id));
	}

	async loadServiceForUser(actingUserId: string, serviceId: string): Promise<ServiceRow & { projectId: string; teamId: string }> {
		const [row] = await db
			.select({
				id: services.id,
				environmentId: services.environmentId,
				projectId: environments.projectId,
				teamId: projects.teamId,
				name: services.name,
				description: services.description,
				type: services.type,
				config: services.config,
				autoDeployEnabled: services.autoDeployEnabled,
				lastPolledCommit: services.lastPolledCommit,
				lastPolledAt: services.lastPolledAt,
				nextPollAt: services.nextPollAt,
				lastPollError: services.lastPollError,
				createdAt: services.createdAt,
				updatedAt: services.updatedAt
			})
			.from(services)
			.innerJoin(environments, eq(environments.id, services.environmentId))
			.innerJoin(projects, eq(projects.id, environments.projectId))
			.innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actingUserId)))
			.where(eq(services.id, serviceId))
			.limit(1);

		if (!row) throw new ServiceNotFoundError();
		return row;
	}

	private async serviceNameTaken(environmentId: string, name: string, exceptServiceId?: string): Promise<boolean> {
		const [row] = await db
			.select({ id: services.id })
			.from(services)
			.where(
				exceptServiceId
					? and(eq(services.environmentId, environmentId), eq(services.name, name), ne(services.id, exceptServiceId))
					: and(eq(services.environmentId, environmentId), eq(services.name, name))
			)
			.limit(1);

		return Boolean(row);
	}

	private async assertSshKeyForTeam(teamId: string, sshKeyId: string): Promise<void> {
		const [row] = await db
			.select({ id: sshKeys.id })
			.from(sshKeys)
			.where(and(eq(sshKeys.id, sshKeyId), eq(sshKeys.scope, 'team'), eq(sshKeys.teamId, teamId)))
			.limit(1);

		if (!row) throw new SshKeyNotAvailableError();
	}

	private async loadDefaultDomainContext(): Promise<DefaultDomainContext> {
		const [settings, runtime] = await Promise.all([
			this.settings.get<Partial<DefaultDomainContext['settings']>>(DEFAULT_DOMAIN_SETTINGS_KEY),
			this.settings.get<Partial<DefaultDomainContext['runtime']>>(DEFAULT_DOMAIN_RUNTIME_KEY)
		]);

		return {
			settings: resolveDefaultDomainSettings(settings),
			runtime: resolveDefaultDomainRuntime(runtime)
		};
	}
}
