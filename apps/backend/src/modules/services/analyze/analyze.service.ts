import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DATABASE_ENGINE_CATALOG, buildDefaultDomainForService, effectiveBase, isDatabaseEngine } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { ApiError } from '../../../shared/errors/api-error.js';
import { SettingsService } from '../../../shared/settings/settings.service.js';
import { errorMessage } from '../../../shared/worker-common/errors.js';
import { EnvironmentsService } from '../../environments/environments.service.js';
import type { GitAuthOptions } from '../../git/git-auth.js';
import { giteaCloneUrl } from '../../git/gitea-api.js';
import { GiteaInstallationsService } from '../../git/gitea-installations.service.js';
import { ServiceNameTakenError } from '../services.errors.js';
import { ServicesService } from '../services.service.js';
import type { ServiceView } from '../services.types.js';
import type { AnalyzeRepositoryInput, AnalyzeRepositoryResult, CreateServicesFromPlanInput, RepoSource } from './analyze.dto.js';
import { AI_SETTINGS_KEY, generateDeploymentPlan, languageModel, parseModelSpec, renderPrompt, type AiSettings } from './llm.js';
import { buildAppInputs, buildDatabaseInputs, buildImageInputs, fillGeneratedSecrets, literalEnv, type PlanTarget } from './plan-inputs.js';
import { snapshotRepo } from './repo-snapshot.js';

const SNAPSHOT_TIMEOUT_MS = 60_000;

@Injectable()
export class ServiceAnalyzeService {
	// ponytail: per-process guard against parallel (paid) LLM runs; each API replica allows one run per user.
	private readonly inFlight = new Set<string>();

	constructor(
		private readonly environments: EnvironmentsService,
		private readonly services: ServicesService,
		private readonly gitea: GiteaInstallationsService,
		private readonly settings: SettingsService
	) {}

	async status(): Promise<{ enabled: boolean }> {
		return { enabled: Boolean(await this.loadEnabledSettings()) };
	}

	async analyze(actingUserId: string, environmentId: string, input: AnalyzeRepositoryInput): Promise<AnalyzeRepositoryResult> {
		const ai = await this.loadEnabledSettings();
		if (!ai) throw new ApiError(409, 'ai_not_configured');
		const environment = await this.environments.loadEnvironmentForUser(actingUserId, environmentId);

		if (this.inFlight.has(actingUserId)) throw new ApiError(429, 'analysis_in_progress');
		this.inFlight.add(actingUserId);
		try {
			const auth = await this.resolveSource(environment.teamId, input.source);
			const [snapshot, existing, domains] = await Promise.all([
				snapshotRepo({ ...auth, branch: input.source.branch, timeoutMs: SNAPSHOT_TIMEOUT_MS }).catch(err => {
					throw new ApiError(422, 'repository_unreachable', { message: errorMessage(err) });
				}),
				this.services.listServicesForEnvironment(actingUserId, environmentId),
				this.services.loadDefaultDomainContext()
			]);
			const { model, effort } = parseModelSpec(ai.model);
			const apiKey = ai.apiKeyCiphertext ? decryptSecret(ai.apiKeyCiphertext) : undefined;
			const plan = await generateDeploymentPlan(structured => languageModel(ai, apiKey, model, structured), effort, renderPrompt(snapshot, existing));
			return { ...plan, defaultDomainBase: effectiveBase(domains.settings, domains.runtime) };
		} finally {
			this.inFlight.delete(actingUserId);
		}
	}

	async createFromPlan(actingUserId: string, environmentId: string, rawInput: CreateServicesFromPlanInput): Promise<ServiceView[]> {
		const input = fillGeneratedSecrets(rawInput);
		const environment = await this.environments.loadEnvironmentForUser(actingUserId, environmentId);
		await this.resolveSource(environment.teamId, input.source);
		const [existing, domains] = await Promise.all([
			this.services.listServicesForEnvironment(actingUserId, environmentId),
			this.services.loadDefaultDomainContext()
		]);
		const scheme = domains.runtime.tls ? 'https' : 'http';

		const plannedNames = [...input.databases, ...input.images, ...input.services].map(service => service.name);
		const existingNames = new Set(existing.map(service => service.name));
		if (new Set(plannedNames).size !== plannedNames.length || plannedNames.some(name => existingNames.has(name))) {
			throw new ServiceNameTakenError();
		}

		// Ids are generated up front so env references resolve to internal hostnames before anything exists.
		const targets = new Map<string, PlanTarget>();
		for (const service of existing) {
			const customHost = service.config.domains[0]?.host;
			targets.set(service.name, {
				id: service.id,
				engine: isDatabaseEngine(service.type) ? service.type : null,
				port: service.config.containerPort,
				publicUrl: customHost ? `${scheme}://${customHost}` : service.defaultUrl,
				env: null
			});
		}
		for (const database of input.databases) {
			targets.set(database.name, {
				id: randomUUID(),
				engine: database.engine,
				port: DATABASE_ENGINE_CATALOG[database.engine].port,
				publicUrl: null,
				env: null
			});
		}
		for (const service of [...input.images, ...input.services]) {
			const id = randomUUID();
			const defaultHost =
				service.publicDomain && service.containerPort != null
					? buildDefaultDomainForService(domains.settings, domains.runtime, { serviceId: id, serviceName: service.name })
					: null;
			const host = service.domain ?? defaultHost;
			targets.set(service.name, {
				id,
				engine: null,
				port: service.containerPort,
				publicUrl: host ? `${scheme}://${host}` : null,
				env: literalEnv(service.env)
			});
		}

		// Validate the whole plan before creating anything; connection URIs only exist once the databases do.
		const databaseInputs = buildDatabaseInputs(input);
		buildImageInputs(input, targets, () => 'pending');
		buildAppInputs(input, targets, () => 'pending');

		// ponytail: sequential creates, not one transaction; a DB-level failure midway leaves earlier services in place.
		const created: ServiceView[] = [];
		for (const databaseInput of databaseInputs) {
			created.push(await this.services.createService(actingUserId, environmentId, databaseInput, targets.get(databaseInput.name)!.id));
		}

		const referencedDatabases = new Set(
			[...input.images, ...input.services].flatMap(service =>
				service.env.filter(entry => entry.reference?.kind === 'connectionUri').map(entry => entry.reference!.service)
			)
		);
		const uris = new Map<string, string>();
		for (const name of referencedDatabases) {
			uris.set(name, (await this.services.getServiceConnection(actingUserId, targets.get(name)!.id)).uri);
		}

		for (const imageInput of buildImageInputs(input, targets, name => uris.get(name)!)) {
			created.push(await this.services.createService(actingUserId, environmentId, imageInput, targets.get(imageInput.name)!.id));
		}
		for (const appInput of buildAppInputs(input, targets, name => uris.get(name)!)) {
			created.push(await this.services.createService(actingUserId, environmentId, appInput, targets.get(appInput.name)!.id));
		}
		return created;
	}

	private async loadEnabledSettings(): Promise<AiSettings | null> {
		const ai = await this.settings.get<AiSettings>(AI_SETTINGS_KEY);
		return ai?.enabled && ai.model.trim() ? ai : null;
	}

	private async resolveSource(teamId: string, source: RepoSource): Promise<GitAuthOptions> {
		switch (source.type) {
			case 'public-repo':
				return { repoUrl: source.repoUrl };
			case 'private-repo':
				await this.services.assertSshKeyForTeam(teamId, source.sshKeyId);
				return { repoUrl: source.repoUrl, sshKeyId: source.sshKeyId };
			case 'github-repo':
				await this.services.assertInstallationForTeam(teamId, source.installationId, 'github');
				return { repoUrl: `https://github.com/${source.repoFullName}.git`, installationId: source.installationId };
			case 'gitea-repo': {
				await this.services.assertInstallationForTeam(teamId, source.installationId, 'gitea');
				const instanceUrl = await this.gitea.instanceUrlForInstallation(teamId, source.installationId);
				return { repoUrl: giteaCloneUrl(instanceUrl, source.repoFullName), installationId: source.installationId };
			}
		}
	}
}
