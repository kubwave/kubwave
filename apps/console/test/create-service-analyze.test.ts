import { describe, expect, test } from 'bun:test';
import type { DeploymentPlanDto, PlanEnvVarDto } from '@kubwave/api-client';
import {
	LITERAL,
	addEnv,
	applyAnswers,
	canCreatePlan,
	applyPaste,
	databaseUsers,
	domainLabel,
	missingCount,
	planErrorMessage,
	planPayload,
	repoSourceInput,
	setIncluded,
	targetOptions,
	toDraft,
	totalMissing,
	usedDatabases,
	type ExistingService
} from '../features/service/create/analyze-model';

const env = (overrides: Partial<PlanEnvVarDto> & { key: string }): PlanEnvVarDto => ({
	value: null,
	secret: false,
	generate: false,
	reference: null,
	note: null,
	...overrides
});

const result = (overrides: Partial<DeploymentPlanDto> = {}): DeploymentPlanDto => ({
	services: [
		{
			name: 'web',
			rootDirectory: 'apps/web',
			builder: 'nixpacks',
			dockerfilePath: null,
			buildCommand: 'bun run build',
			startCommand: null,
			containerPort: 3000,
			watchPaths: ['packages/ui'],
			publicDomain: true,
			env: [
				env({ key: 'DATABASE_URL', reference: { service: 'db', kind: 'connectionUri', key: null } }),
				env({ key: 'API_URL', reference: { service: 'api', kind: 'url', key: null } }),
				env({ key: 'STRIPE_KEY', secret: true, note: 'from the Stripe dashboard' }),
				env({ key: 'SESSION_SECRET', secret: true, generate: true }),
				env({ key: 'LOG_LEVEL', value: 'info' })
			],
			reason: 'Next.js app'
		},
		{
			name: 'worker',
			rootDirectory: 'apps/worker',
			builder: 'dockerfile',
			dockerfilePath: 'apps/worker/Dockerfile',
			buildCommand: null,
			startCommand: null,
			containerPort: null,
			watchPaths: [],
			publicDomain: false,
			env: [env({ key: 'STRIPE_KEY', secret: true }), env({ key: 'SHARED', reference: { service: 'web', kind: 'env', key: 'LOG_LEVEL' } })],
			reason: 'Queue worker'
		}
	],
	images: [
		{
			name: 'minio',
			image: 'minio/minio',
			tag: 'latest',
			containerPort: 9000,
			args: ['server', '/data'],
			volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }],
			publicDomain: false,
			env: [env({ key: 'MINIO_ROOT_PASSWORD', secret: true, generate: true })],
			reason: 'Object storage'
		}
	],
	databases: [
		{ name: 'db', engine: 'postgres' },
		{ name: 'cache-db', engine: 'mysql' }
	],
	questions: [{ kind: 'values', title: 'Stripe', description: 'Payments', services: ['web', 'worker'], envKeys: ['STRIPE_KEY'] }],
	warnings: ['No lockfile found'],
	defaultDomainBase: 'apps.example.com',
	...overrides
});

const existing: ExistingService[] = [
	{ name: 'api', type: 'docker-image', defaultUrl: null, config: { containerPort: 8080, domains: [] } },
	{ name: 'legacy-db', type: 'postgres', defaultUrl: null, config: { containerPort: 5432, domains: [] } },
	{ name: 'site', type: 'docker-image', defaultUrl: 'https://site.apps.example.com', config: { containerPort: null, domains: [] } }
];

describe('toDraft', () => {
	test('maps apps and images to editable drafts', () => {
		const plan = toDraft(result(), existing);
		const [web, worker, minio] = plan.services;
		expect(web).toMatchObject({
			kind: 'app',
			name: 'web',
			containerPort: '3000',
			watchPaths: 'packages/ui',
			buildCommand: 'bun run build',
			include: true
		});
		expect(worker).toMatchObject({ builder: 'dockerfile', dockerfilePath: 'apps/worker/Dockerfile', containerPort: '' });
		expect(minio).toMatchObject({ kind: 'image', image: 'minio/minio', tag: 'latest', args: 'server\n/data' });
		expect(minio?.volumes).toMatchObject([{ name: 'data', mountPath: '/data', size: '5Gi' }]);
	});

	test('resolves references to planned databases, planned services and existing services', () => {
		const plan = toDraft(result(), existing);
		const [web, worker] = plan.services;
		const db = plan.databases[0]!;
		expect(web?.env[0]).toMatchObject({ key: 'DATABASE_URL', kind: 'connectionUri', target: `db:${db.id}` });
		expect(web?.env[1]).toMatchObject({ key: 'API_URL', kind: 'url', target: 'existing:api' });
		expect(web?.env[4]).toMatchObject({ key: 'LOG_LEVEL', value: 'info', kind: null, target: LITERAL });
		expect(worker?.env[1]).toMatchObject({ kind: 'env', target: `svc:${web?.id}`, refKey: 'LOG_LEVEL' });
	});

	test('an unknown reference target falls back to a typed value', () => {
		const plan = toDraft(result(), []);
		expect(plan.services[0]?.env[1]).toMatchObject({ key: 'API_URL', kind: 'url', target: LITERAL, value: '' });
	});

	test('asks for every public domain and every value the model left open', () => {
		const plan = toDraft(result(), existing);
		const [web] = plan.services;
		expect(plan.questions.map(q => [q.kind, q.title, q.envKeys])).toEqual([
			['domain', 'Domain for web', []],
			['values', 'Stripe', ['STRIPE_KEY']]
		]);
		expect(plan.questions[0]?.serviceIds).toEqual([web!.id]);
		expect(plan.answers[plan.questions[1]!.id]).toEqual({ STRIPE_KEY: '' });
	});

	test('adds a catch-all question for open values the model did not ask about', () => {
		const plan = toDraft(result({ questions: [] }), existing);
		expect(plan.questions.map(q => q.title)).toEqual(['Domain for web', 'Other values for web', 'Other values for worker']);
		expect(plan.questions[1]?.envKeys).toEqual(['STRIPE_KEY']);
	});

	test('keeps a model-provided domain question once and drops values that are references', () => {
		const plan = toDraft(
			result({
				questions: [
					{ kind: 'domain', title: 'Where should web live?', description: null, services: ['web'], envKeys: [] },
					{ kind: 'domain', title: 'Duplicate', description: null, services: ['web'], envKeys: [] },
					{ kind: 'values', title: 'Refs only', description: null, services: ['web'], envKeys: ['DATABASE_URL'] }
				]
			}),
			existing
		);
		expect(plan.questions.map(q => q.title)).toEqual(['Where should web live?', 'Other values for web', 'Other values for worker']);
	});
});

describe('questions', () => {
	test('applyAnswers fills the value on every listed service', () => {
		const plan = toDraft(result(), existing);
		plan.answers[plan.questions[1]!.id] = { STRIPE_KEY: 'sk_live' };
		applyAnswers(plan);
		expect(plan.services[0]?.env.find(e => e.key === 'STRIPE_KEY')?.value).toBe('sk_live');
		expect(plan.services[1]?.env.find(e => e.key === 'STRIPE_KEY')?.value).toBe('sk_live');
	});
});

describe('review', () => {
	test('offers reference targets that fit the kind', () => {
		const plan = toDraft(result(), existing);
		const [web, worker, minio] = plan.services;
		const [db, cacheDb] = plan.databases;
		const labels = (entryIndex: number, service = web!) => targetOptions(plan, service.env[entryIndex]!, service, existing).map(o => o.label);
		expect(labels(0)).toEqual(['db (new postgres)', 'cache-db (new mysql)', 'legacy-db (existing)']);
		expect(targetOptions(plan, web!.env[0]!, web!, existing).map(o => o.value)).toEqual([`db:${db!.id}`, `db:${cacheDb!.id}`, 'existing:legacy-db']);
		expect(labels(1)).toEqual(['minio (new)', 'api (existing)']);
		expect(labels(1, worker!)).toEqual(['web (LOG_LEVEL)']);
		web!.env[1]!.kind = 'publicUrl';
		expect(labels(1)).toEqual(['web (new)', 'site (existing)']);
		minio!.include = false;
		web!.env[1]!.kind = 'url';
		expect(labels(1)).toEqual(['api (existing)']);
	});

	test('excluding a service turns references to it back into typed values', () => {
		const plan = toDraft(result(), existing);
		const [web, worker] = plan.services;
		setIncluded(plan, web!.id, false);
		expect(web!.include).toBe(false);
		expect(worker!.env[1]).toMatchObject({ key: 'SHARED', target: LITERAL });
		const payload = planPayload(plan, { type: 'public-repo', repoUrl: 'https://x/y', branch: 'main' }, false);
		expect(payload.services[0]?.env[1]).toMatchObject({ key: 'SHARED', reference: null });
	});

	test('can only create a plan that still includes an app service', () => {
		const plan = toDraft(result(), existing);
		expect(canCreatePlan(plan)).toBe(true);
		setIncluded(plan, plan.services[0]!.id, false);
		setIncluded(plan, plan.services[1]!.id, false);
		expect(canCreatePlan(plan)).toBe(false);
	});

	test('only creates databases an included service still references', () => {
		const plan = toDraft(result(), existing);
		const [db] = plan.databases;
		expect(usedDatabases(plan).map(d => d.name)).toEqual(['db']);
		expect(databaseUsers(plan, db!)).toEqual(['web']);
		plan.services[0]!.include = false;
		expect(usedDatabases(plan)).toEqual([]);
	});

	test('counts values that are still empty', () => {
		const plan = toDraft(result(), existing);
		expect(missingCount(plan.services[0]!)).toBe(1);
		expect(totalMissing(plan)).toBe(2);
		plan.services[1]!.include = false;
		expect(totalMissing(plan)).toBe(1);
	});

	test('labels the domain', () => {
		const plan = toDraft(result(), existing);
		const [web, worker] = plan.services;
		expect(domainLabel(plan, worker!)).toBe('internal');
		expect(domainLabel(plan, web!)).toBe('generated domain');
		web!.domain = ' shop.example.com ';
		expect(domainLabel(plan, web!)).toBe('shop.example.com');
		expect(domainLabel({ ...plan, defaultDomainBase: null }, { ...web!, domain: '' })).toBe('no domain');
	});

	test('paste fills existing keys, adds new ones and guesses secrets', () => {
		const plan = toDraft(result(), existing);
		const web = plan.services[0]!;
		applyPaste(web, 'DATABASE_URL=postgres://x\nNEW_TOKEN="abc"\nPLAIN=1');
		expect(web.env.find(e => e.key === 'DATABASE_URL')).toMatchObject({ value: 'postgres://x', target: LITERAL });
		expect(web.env.slice(-2)).toMatchObject([
			{ key: 'NEW_TOKEN', value: 'abc', secret: true },
			{ key: 'PLAIN', value: '1', secret: false }
		]);
	});
});

describe('planPayload', () => {
	test('builds the create request from the reviewed plan', () => {
		const plan = toDraft(result(), existing);
		const [web, worker, minio] = plan.services;
		web!.domain = 'shop.example.com';
		web!.env[4]!.value = '';
		addEnv(web!);
		worker!.include = false;
		minio!.args = ' server \n\n/data';
		const source = { type: 'github-repo' as const, installationId: 'i', repoFullName: 'acme/shop', branch: 'main' };
		const payload = planPayload(plan, source, true);
		expect(payload.source).toEqual(source);
		expect(payload.autoDeploy).toBe(true);
		expect(payload.databases).toEqual([{ name: 'db', engine: 'postgres' }]);
		expect(payload.services).toEqual([
			{
				name: 'web',
				rootDirectory: 'apps/web',
				builder: 'nixpacks',
				dockerfilePath: null,
				buildCommand: 'bun run build',
				startCommand: null,
				containerPort: 3000,
				watchPaths: ['packages/ui'],
				publicDomain: true,
				domain: 'shop.example.com',
				env: [
					{ key: 'DATABASE_URL', value: null, secret: false, generate: false, reference: { service: 'db', kind: 'connectionUri', key: null } },
					{ key: 'API_URL', value: null, secret: false, generate: false, reference: { service: 'api', kind: 'url', key: null } },
					{ key: 'STRIPE_KEY', value: null, secret: true, generate: false, reference: null },
					{ key: 'SESSION_SECRET', value: null, secret: true, generate: true, reference: null },
					{ key: 'LOG_LEVEL', value: null, secret: false, generate: false, reference: null }
				]
			}
		]);
		expect(payload.images).toEqual([
			{
				name: 'minio',
				image: 'minio/minio',
				tag: 'latest',
				containerPort: 9000,
				args: ['server', '/data'],
				volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }],
				publicDomain: false,
				domain: null,
				env: [{ key: 'MINIO_ROOT_PASSWORD', value: null, secret: true, generate: true, reference: null }]
			}
		]);
	});

	test('references to renamed planned services use the new name, env references keep their key', () => {
		const plan = toDraft(result(), existing);
		const [web, worker] = plan.services;
		web!.name = ' frontend ';
		plan.databases[0]!.name = 'main-db';
		const payload = planPayload(plan, { type: 'public-repo', repoUrl: 'https://x/y', branch: 'main' }, false);
		expect(payload.services[0]?.env[0]?.reference).toEqual({ service: 'main-db', kind: 'connectionUri', key: null });
		expect(payload.services[1]?.env[1]?.reference).toEqual({ service: 'frontend', kind: 'env', key: 'LOG_LEVEL' });
		expect(worker!.dockerfilePath).toBe('apps/worker/Dockerfile');
		expect(payload.services[1]).toMatchObject({ dockerfilePath: 'apps/worker/Dockerfile', buildCommand: null, containerPort: null, domain: null });
	});
});

describe('repoSourceInput', () => {
	const base = { installationId: '', repoFullName: '', repoUrl: '', sshKeyId: '', branch: ' main ' };

	test('is complete only when the source-specific fields are set', () => {
		expect(repoSourceInput({ ...base, type: 'github-repo', installationId: 'i' })).toBeNull();
		expect(repoSourceInput({ ...base, type: 'gitea-repo', installationId: 'i', repoFullName: 'a/b' })).toEqual({
			type: 'gitea-repo',
			installationId: 'i',
			repoFullName: 'a/b',
			branch: 'main'
		});
		expect(repoSourceInput({ ...base, type: 'public-repo', repoUrl: ' https://x/y ' })).toEqual({
			type: 'public-repo',
			repoUrl: 'https://x/y',
			branch: 'main'
		});
		expect(repoSourceInput({ ...base, type: 'private-repo', repoUrl: 'git@x:y.git' })).toBeNull();
		expect(repoSourceInput({ ...base, type: 'private-repo', repoUrl: 'git@x:y.git', sshKeyId: 'k' })).toMatchObject({ sshKeyId: 'k' });
		expect(repoSourceInput({ ...base, type: 'public-repo', repoUrl: 'https://x/y', branch: ' ' })).toBeNull();
	});
});

describe('planErrorMessage', () => {
	test('explains AI failures', () => {
		expect(planErrorMessage({ error: 'ai_not_configured' }, 'x')).toBe(
			'The AI assistant is not configured. An admin can enable it under Settings → Integrations.'
		);
		expect(planErrorMessage({ error: 'repository_unreachable', details: { message: 'auth failed' } }, 'x')).toBe(
			'Could not read the repository: auth failed Private repositories need GitHub, Gitea, or a deploy key as the source.'
		);
		expect(planErrorMessage({ error: 'ai_provider_error' }, 'x')).toBe('The AI provider returned an error.');
		expect(planErrorMessage({ error: 'invalid_plan' }, 'x')).toBe('The plan is invalid. Check names, paths, and references.');
		expect(planErrorMessage({ error: 'service_name_taken' }, 'x')).toBe('A service with that name already exists.');
		expect(planErrorMessage({ error: 'other' }, 'Analysis failed.')).toBe('Analysis failed.');
	});
});
