import type { CreateServicesFromPlanDto, DeploymentPlanDto, PlanEnvVarInputDto, PlanReferenceDto, RepoSourceDto } from '@kubwave/api-client';
import { errorCode, serviceErrorMessage } from '@/lib/api/api-error';
import type { Service } from '@/lib/api/types';
import { parseDotenv } from '@/lib/parse-dotenv';
import { parseWatchPathsTextarea } from '@/lib/repo-watch-paths';
import { isDatabaseEngine } from '@/lib/service-types';
import { uuid } from '@/lib/uuid';
import { parsePort } from './model';

export type ReferenceKind = PlanReferenceDto['kind'];
export type ExistingService = Pick<Service, 'name' | 'type' | 'defaultUrl'> & {
	config: { containerPort: number | null; domains: Array<{ host: string }> };
};

// Radix SelectItem rejects an empty value, so "type a value instead" needs a sentinel.
export const LITERAL = 'literal';
const SECRET_KEY_RE = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|CREDENTIAL/i;

export const REFERENCE_LABEL: Record<ReferenceKind, string> = {
	url: 'internal URL of',
	publicUrl: 'public URL of',
	connectionUri: 'connection URI of',
	env: 'value from'
};

export interface DraftEnv {
	id: string;
	key: string;
	value: string;
	secret: boolean;
	generate: boolean;
	kind: ReferenceKind | null;
	// "db:<id>" / "svc:<id>" for planned services, "existing:<name>" for services already in the environment, LITERAL for a typed value.
	target: string;
	// For kind "env": which key of the target to copy.
	refKey: string | null;
	note: string | null;
}

export interface DraftService {
	id: string;
	// "app" builds from the repository; "image" runs a backing service (e.g. MinIO) from a container image.
	kind: 'app' | 'image';
	include: boolean;
	name: string;
	image: string;
	tag: string;
	args: string;
	volumes: Array<{ id: string; name: string; mountPath: string; size: string }>;
	rootDirectory: string;
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath: string;
	buildCommand: string;
	startCommand: string;
	containerPort: string;
	watchPaths: string;
	publicDomain: boolean;
	domain: string;
	env: DraftEnv[];
	reason: string;
}

export interface DraftDatabase {
	id: string;
	name: string;
	engine: DeploymentPlanDto['databases'][number]['engine'];
}

export interface DraftQuestion {
	id: string;
	kind: 'domain' | 'values';
	title: string;
	description: string | null;
	serviceIds: string[];
	envKeys: string[];
}

export interface DraftPlan {
	services: DraftService[];
	databases: DraftDatabase[];
	questions: DraftQuestion[];
	// Answers to "values" questions, keyed by question id then env key; applied to every listed service on continue.
	answers: Record<string, Record<string, string>>;
	warnings: string[];
	defaultDomainBase: string | null;
}

const newId = uuid;

export const isReference = (entry: DraftEnv) => entry.kind !== null && entry.target !== LITERAL;
export const needsValue = (entry: DraftEnv) => !isReference(entry) && !entry.generate && !entry.value;

export const emptyEnv = (overrides: Partial<DraftEnv> = {}): DraftEnv => ({
	id: newId(),
	key: '',
	value: '',
	secret: false,
	generate: false,
	kind: null,
	target: LITERAL,
	refKey: null,
	note: null,
	...overrides
});

export function toDraft(result: DeploymentPlanDto, existing: readonly ExistingService[]): DraftPlan {
	const databases: DraftDatabase[] = result.databases.map(database => ({ id: newId(), ...database }));
	const blank = { include: true, image: '', tag: '', args: '', volumes: [], domain: '', env: [] };
	const apps: DraftService[] = result.services.map(service => ({
		...blank,
		id: newId(),
		kind: 'app',
		name: service.name,
		rootDirectory: service.rootDirectory,
		builder: service.builder,
		dockerfilePath: service.dockerfilePath ?? '',
		buildCommand: service.buildCommand ?? '',
		startCommand: service.startCommand ?? '',
		containerPort: service.containerPort == null ? '' : String(service.containerPort),
		watchPaths: service.watchPaths.join('\n'),
		publicDomain: service.publicDomain,
		reason: service.reason
	}));
	const images: DraftService[] = result.images.map(image => ({
		...blank,
		id: newId(),
		kind: 'image',
		name: image.name,
		image: image.image,
		tag: image.tag,
		args: image.args.join('\n'),
		volumes: image.volumes.map(volume => ({ id: newId(), ...volume })),
		rootDirectory: '',
		builder: 'nixpacks',
		dockerfilePath: '',
		buildCommand: '',
		startCommand: '',
		containerPort: image.containerPort == null ? '' : String(image.containerPort),
		watchPaths: '',
		publicDomain: image.publicDomain,
		reason: image.reason
	}));
	const services = [...apps, ...images];
	const byName = new Map(services.map(service => [service.name, service]));

	const targetFor = (name: string): string => {
		const database = databases.find(d => d.name === name);
		if (database) return `db:${database.id}`;
		const service = byName.get(name);
		if (service) return `svc:${service.id}`;
		return existing.some(s => s.name === name) ? `existing:${name}` : LITERAL;
	};

	[...result.services, ...result.images].forEach((service, i) => {
		services[i]!.env = service.env.map(entry =>
			emptyEnv({
				key: entry.key,
				value: entry.value ?? '',
				secret: entry.secret,
				generate: entry.generate,
				kind: entry.reference?.kind ?? null,
				target: entry.reference ? targetFor(entry.reference.service) : LITERAL,
				refKey: entry.reference?.key ?? null,
				note: entry.note
			})
		);
	});

	const questions: DraftQuestion[] = [];
	const hasDomainQuestion = (serviceId: string) => questions.some(q => q.kind === 'domain' && q.serviceIds.includes(serviceId));
	for (const question of result.questions) {
		const listed = question.services.map(name => byName.get(name)).filter(service => service !== undefined);
		if (question.kind === 'domain') {
			const service = listed.find(s => s.publicDomain);
			if (service && !hasDomainQuestion(service.id)) {
				questions.push({
					id: newId(),
					kind: 'domain',
					title: question.title,
					description: question.description,
					serviceIds: [service.id],
					envKeys: []
				});
			}
			continue;
		}
		const envKeys = question.envKeys.filter(key => listed.some(service => service.env.some(entry => entry.key === key && !isReference(entry))));
		if (envKeys.length) {
			questions.push({
				id: newId(),
				kind: 'values',
				title: question.title,
				description: question.description,
				serviceIds: listed.map(s => s.id),
				envKeys
			});
		}
	}

	// Safety net: every public service gets a domain question and every value the user must supply is asked somewhere, even if the model forgot.
	for (const service of services) {
		if (service.publicDomain && !hasDomainQuestion(service.id)) {
			questions.unshift({
				id: newId(),
				kind: 'domain',
				title: `Domain for ${service.name}`,
				description: null,
				serviceIds: [service.id],
				envKeys: []
			});
		}
		const asked = new Set(questions.filter(q => q.kind === 'values' && q.serviceIds.includes(service.id)).flatMap(q => q.envKeys));
		const open = service.env.filter(entry => needsValue(entry) && !asked.has(entry.key)).map(entry => entry.key);
		if (open.length) {
			questions.push({
				id: newId(),
				kind: 'values',
				title: `Other values for ${service.name}`,
				description: null,
				serviceIds: [service.id],
				envKeys: open
			});
		}
	}

	const answers: DraftPlan['answers'] = {};
	for (const question of questions.filter(q => q.kind === 'values')) {
		const entries = services.filter(s => question.serviceIds.includes(s.id)).flatMap(s => s.env);
		answers[question.id] = Object.fromEntries(question.envKeys.map(key => [key, entries.find(e => e.key === key)?.value ?? '']));
	}

	return { services, databases, questions, answers, warnings: result.warnings, defaultDomainBase: result.defaultDomainBase };
}

export const questionServices = (plan: DraftPlan, question: DraftQuestion): DraftService[] =>
	question.serviceIds.map(id => plan.services.find(service => service.id === id)).filter(service => service !== undefined);

export const isSecretKey = (plan: DraftPlan, question: DraftQuestion, key: string) =>
	questionServices(plan, question).some(service => service.env.some(entry => entry.key === key && entry.secret));

export function noteFor(plan: DraftPlan, question: DraftQuestion, key: string): string | null {
	for (const service of questionServices(plan, question)) {
		const note = service.env.find(entry => entry.key === key)?.note;
		if (note) return note;
	}
	return null;
}

// Mutates `plan`; callers pass a copy.
export function applyAnswers(plan: DraftPlan): void {
	for (const question of plan.questions) {
		if (question.kind !== 'values') continue;
		for (const [key, value] of Object.entries(plan.answers[question.id] ?? {})) {
			for (const service of questionServices(plan, question)) {
				const entry = service.env.find(e => e.key === key);
				if (entry && !isReference(entry)) entry.value = value;
			}
		}
	}
}

export const includedServices = (plan: DraftPlan) => plan.services.filter(service => service.include);

// The API creates a plan only with at least one app service; images alone are not enough.
export const canCreatePlan = (plan: DraftPlan) => includedServices(plan).some(service => service.kind === 'app');

// Excluding a service also turns references to it back into typed values, since the API rejects
// a plan that references a service it doesn't create.
export function setIncluded(plan: DraftPlan, serviceId: string, include: boolean): void {
	const service = plan.services.find(candidate => candidate.id === serviceId);
	if (!service) return;
	service.include = include;
	if (include) return;
	for (const entry of plan.services.flatMap(other => other.env)) if (entry.target === `svc:${serviceId}`) entry.target = LITERAL;
}

export function targetOptions(
	plan: DraftPlan,
	entry: DraftEnv,
	self: DraftService,
	existing: readonly ExistingService[]
): Array<{ value: string; label: string }> {
	const planned = includedServices(plan);
	const label = (name: string) => name || 'unnamed';
	switch (entry.kind) {
		case 'env':
			return planned
				.filter(s => s.id !== self.id && s.env.some(e => e.key === entry.refKey && !isReference(e)))
				.map(s => ({ value: `svc:${s.id}`, label: `${label(s.name)} (${entry.refKey})` }));
		case 'connectionUri':
			return [
				...plan.databases.map(d => ({ value: `db:${d.id}`, label: `${label(d.name)} (new ${d.engine})` })),
				...existing.filter(s => isDatabaseEngine(s.type)).map(s => ({ value: `existing:${s.name}`, label: `${s.name} (existing)` }))
			];
		case 'publicUrl':
			return [
				...planned.filter(s => s.publicDomain).map(s => ({ value: `svc:${s.id}`, label: `${label(s.name)} (new)` })),
				...existing.filter(s => s.defaultUrl || s.config.domains.length).map(s => ({ value: `existing:${s.name}`, label: `${s.name} (existing)` }))
			];
		default:
			return [
				...planned.filter(s => s.id !== self.id && portOf(s) !== null).map(s => ({ value: `svc:${s.id}`, label: `${label(s.name)} (new)` })),
				...existing
					.filter(s => !isDatabaseEngine(s.type) && s.config.containerPort != null)
					.map(s => ({ value: `existing:${s.name}`, label: `${s.name} (existing)` }))
			];
	}
}

// A new database is only created while an included service still references it.
export function usedDatabases(plan: DraftPlan): DraftDatabase[] {
	const used = new Set(includedServices(plan).flatMap(service => service.env.map(entry => entry.target)));
	return plan.databases.filter(database => used.has(`db:${database.id}`));
}

export const databaseUsers = (plan: DraftPlan, database: DraftDatabase) =>
	includedServices(plan)
		.filter(service => service.env.some(entry => entry.target === `db:${database.id}`))
		.map(service => service.name);

export const missingCount = (service: DraftService) => service.env.filter(needsValue).length;
export const totalMissing = (plan: DraftPlan) => includedServices(plan).reduce((sum, service) => sum + missingCount(service), 0);

export function domainLabel(plan: Pick<DraftPlan, 'defaultDomainBase'>, service: DraftService): string {
	if (!service.publicDomain) return 'internal';
	if (service.domain.trim()) return service.domain.trim();
	return plan.defaultDomainBase ? 'generated domain' : 'no domain';
}

function targetName(plan: DraftPlan, target: string): string {
	const split = target.indexOf(':');
	const kind = target.slice(0, split);
	const ref = target.slice(split + 1);
	if (kind === 'existing') return ref;
	if (kind === 'db') return plan.databases.find(d => d.id === ref)?.name.trim() ?? '';
	return plan.services.find(s => s.id === ref)?.name.trim() ?? '';
}

export function addEnv(service: DraftService): void {
	service.env.push(emptyEnv());
}

export function applyPaste(service: DraftService, text: string): void {
	for (const { key, value } of parseDotenv(text)) {
		const entry = service.env.find(e => e.key === key);
		if (entry) {
			entry.value = value;
			entry.target = LITERAL;
		} else {
			service.env.push(emptyEnv({ key, value, secret: SECRET_KEY_RE.test(key) }));
		}
	}
}

function envPayload(plan: DraftPlan, service: DraftService): PlanEnvVarInputDto[] {
	return service.env
		.filter(entry => entry.key.trim())
		.map(entry => ({
			key: entry.key.trim(),
			value: isReference(entry) || entry.value === '' ? null : entry.value,
			secret: entry.secret,
			generate: entry.generate,
			reference:
				isReference(entry) && entry.kind
					? { service: targetName(plan, entry.target), kind: entry.kind, key: entry.kind === 'env' ? entry.refKey : null }
					: null
		}));
}

const portOf = (service: DraftService) => parsePort(service.containerPort);

const domainOf = (service: DraftService) => (service.publicDomain && service.domain.trim() ? service.domain.trim() : null);

export function planPayload(plan: DraftPlan, source: RepoSourceDto, autoDeploy: boolean): CreateServicesFromPlanDto {
	const included = includedServices(plan);
	return {
		source,
		autoDeploy,
		images: included
			.filter(service => service.kind === 'image')
			.map(image => ({
				name: image.name.trim(),
				image: image.image.trim(),
				tag: image.tag.trim(),
				containerPort: portOf(image),
				args: image.args
					.split('\n')
					.map(arg => arg.trim())
					.filter(Boolean),
				volumes: image.volumes.map(volume => ({ name: volume.name.trim(), mountPath: volume.mountPath.trim(), size: volume.size.trim() })),
				publicDomain: image.publicDomain,
				domain: domainOf(image),
				env: envPayload(plan, image)
			})),
		services: included
			.filter(service => service.kind === 'app')
			.map(service => ({
				name: service.name.trim(),
				rootDirectory: service.rootDirectory.trim(),
				builder: service.builder,
				dockerfilePath: service.builder === 'dockerfile' ? service.dockerfilePath.trim() || null : null,
				buildCommand: service.builder === 'nixpacks' ? service.buildCommand.trim() || null : null,
				startCommand: service.builder === 'nixpacks' ? service.startCommand.trim() || null : null,
				containerPort: portOf(service),
				watchPaths: parseWatchPathsTextarea(service.watchPaths),
				publicDomain: service.publicDomain,
				domain: domainOf(service),
				env: envPayload(plan, service)
			})),
		databases: usedDatabases(plan).map(database => ({ name: database.name.trim(), engine: database.engine }))
	};
}

export type RepoSourceFields = {
	type: RepoSourceDto['type'];
	installationId: string;
	repoFullName: string;
	repoUrl: string;
	sshKeyId: string;
	branch: string;
};

// The analyze request source, or null while the picked source type is still missing a field.
export function repoSourceInput(fields: RepoSourceFields): RepoSourceDto | null {
	const branch = fields.branch.trim();
	const repoUrl = fields.repoUrl.trim();
	if (!branch) return null;
	switch (fields.type) {
		case 'github-repo':
		case 'gitea-repo':
			return fields.installationId && fields.repoFullName
				? { type: fields.type, installationId: fields.installationId, repoFullName: fields.repoFullName, branch }
				: null;
		case 'public-repo':
			return repoUrl ? { type: 'public-repo', repoUrl, branch } : null;
		case 'private-repo':
			return repoUrl && fields.sshKeyId ? { type: 'private-repo', repoUrl, sshKeyId: fields.sshKeyId, branch } : null;
	}
}

export function planErrorMessage(err: unknown, fallback: string): string {
	const message = (err as { details?: { message?: unknown } } | null)?.details?.message;
	const detail = typeof message === 'string' ? message : null;
	switch (errorCode(err)) {
		case 'ai_not_configured':
			return 'The AI assistant is not configured. An admin can enable it under Settings → Integrations.';
		case 'analysis_in_progress':
			return 'An analysis is already running for your account.';
		case 'repository_unreachable':
			return `Could not read the repository${detail ? `: ${detail}` : '.'} Private repositories need GitHub, Gitea, or a deploy key as the source.`;
		case 'ai_invalid_output':
			return 'The model did not return a usable plan. Try again or configure a more capable model.';
		case 'ai_provider_error':
			return `The AI provider returned an error${detail ? `: ${detail}` : '.'}`;
		case 'invalid_plan':
			return detail ?? 'The plan is invalid. Check names, paths, and references.';
		default:
			return serviceErrorMessage(err, fallback);
	}
}
