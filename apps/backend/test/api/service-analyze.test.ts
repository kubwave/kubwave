import { describe, expect, test } from 'bun:test';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { internalServiceName } from '@kubwave/kube';
import { updateAiSettingsSchema } from '~/modules/platform/settings/ai/platform-ai-settings.dto';
import { createServicesFromPlanSchema, type CreateServicesFromPlanInput, type DeploymentPlan } from '~/modules/services/analyze/analyze.dto';
import { effortProviderOptions, generateDeploymentPlan, parseModelSpec } from '~/modules/services/analyze/llm';
import {
	buildAppInputs,
	buildImageInputs,
	fillGeneratedSecrets,
	literalEnv,
	normalizeRepoPath,
	type PlanTarget
} from '~/modules/services/analyze/plan-inputs';

const plan: DeploymentPlan = {
	services: [
		{
			name: 'api',
			rootDirectory: '',
			builder: 'dockerfile',
			dockerfilePath: 'apps/api/Dockerfile',
			buildCommand: null,
			startCommand: null,
			containerPort: 3000,
			watchPaths: ['apps/api'],
			publicDomain: true,
			env: [
				{
					key: 'DATABASE_URL',
					value: null,
					secret: true,
					generate: false,
					reference: { service: 'db', kind: 'connectionUri', key: null },
					note: null
				}
			],
			reason: 'NestJS API'
		}
	],
	images: [],
	databases: [{ name: 'db', engine: 'postgres' }],
	questions: [{ kind: 'domain', title: 'Domain for api', description: null, services: ['api'], envKeys: [] }],
	warnings: []
};

function mockModel(text: string) {
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ type: 'text', text }],
			finishReason: { unified: 'stop', raw: 'stop' },
			usage: {
				inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: 1, text: 1, reasoning: 0 }
			},
			warnings: []
		}
	});
}

function planInput(overrides: Record<string, unknown> = {}): CreateServicesFromPlanInput {
	return createServicesFromPlanSchema.parse({
		source: { type: 'public-repo', repoUrl: 'https://github.com/acme/shop.git', branch: 'main' },
		services: [
			{
				name: 'web',
				rootDirectory: './apps/web/',
				builder: 'nixpacks',
				dockerfilePath: null,
				buildCommand: null,
				startCommand: 'bun run start',
				containerPort: 3000,
				watchPaths: ['apps/web', 'packages/ui/'],
				publicDomain: true,
				env: [
					{ key: 'DATABASE_URL', value: null, secret: false, reference: { service: 'db', kind: 'connectionUri' } },
					{ key: 'API_URL', value: null, secret: false, reference: { service: 'api', kind: 'url' } },
					{ key: 'LOG_LEVEL', value: 'info', secret: false, reference: null },
					{ key: 'STRIPE_KEY', value: null, secret: true, reference: null }
				],
				...overrides
			}
		],
		databases: []
	});
}

const targets = new Map<string, PlanTarget>([
	['db', { id: '11111111-1111-4111-8111-111111111111', engine: 'postgres', port: 5432, publicUrl: null, env: null }],
	['api', { id: '22222222-2222-4222-8222-222222222222', engine: null, port: 8080, publicUrl: 'https://api.example.com', env: null }],
	['worker', { id: '33333333-3333-4333-8333-333333333333', engine: null, port: null, publicUrl: null, env: null }],
	['web', { id: '44444444-4444-4444-8444-444444444444', engine: null, port: 3000, publicUrl: 'https://shop.example.com', env: null }]
]);

describe('parseModelSpec', () => {
	test('splits a known effort suffix off the model id', () => {
		expect(parseModelSpec('claude-opus-5:high')).toEqual({ model: 'claude-opus-5', effort: 'high' });
		expect(parseModelSpec(' gpt-5:minimal ')).toEqual({ model: 'gpt-5', effort: 'minimal' });
	});

	test('keeps colons that belong to the model id', () => {
		expect(parseModelSpec('claude-opus-5')).toEqual({ model: 'claude-opus-5', effort: null });
		expect(parseModelSpec('qwen2.5-coder:32b')).toEqual({ model: 'qwen2.5-coder:32b', effort: null });
		expect(parseModelSpec('qwen2.5-coder:32b:low')).toEqual({ model: 'qwen2.5-coder:32b', effort: 'low' });
		expect(parseModelSpec(':high')).toEqual({ model: ':high', effort: null });
	});

	test('only sends provider options when an effort is set', () => {
		expect(effortProviderOptions(null)).toBeUndefined();
		expect(effortProviderOptions('high')).toEqual({ anthropic: { effort: 'high' }, custom: { reasoningEffort: 'high' } });
	});
});

describe('generateDeploymentPlan', () => {
	test('returns the parsed plan from the model output', async () => {
		expect(await generateDeploymentPlan(() => mockModel(JSON.stringify(plan)), null, 'repo')).toEqual(plan);
	});

	test('maps output that does not match the schema to ai_invalid_output', async () => {
		const promise = generateDeploymentPlan(() => mockModel(JSON.stringify({ services: 'nope' })), null, 'repo');
		await expect(promise).rejects.toMatchObject({ status: 502, code: 'ai_invalid_output' });
	});

	test('retries in plain JSON mode when the provider rejects json_schema', async () => {
		const rejected = new MockLanguageModelV4({
			doGenerate: async () => {
				throw new APICallError({
					message: 'This response_format type is unavailable now',
					url: 'https://api.example.com/v1/chat/completions',
					requestBodyValues: {},
					statusCode: 400,
					isRetryable: false
				});
			}
		});
		const modes: boolean[] = [];
		const result = await generateDeploymentPlan(
			structured => {
				modes.push(structured);
				return structured ? rejected : mockModel(JSON.stringify(plan));
			},
			null,
			'repo'
		);
		expect(result).toEqual(plan);
		expect(modes).toEqual([true, false]);
	});

	test('does not retry on other provider errors', async () => {
		const unauthorized = new MockLanguageModelV4({
			doGenerate: async () => {
				throw new APICallError({ message: 'Invalid API key', url: 'https://x', requestBodyValues: {}, statusCode: 401, isRetryable: false });
			}
		});
		let calls = 0;
		const promise = generateDeploymentPlan(
			() => {
				calls++;
				return unauthorized;
			},
			null,
			'repo'
		);
		await expect(promise).rejects.toMatchObject({ status: 502, code: 'ai_provider_error' });
		expect(calls).toBe(1);
	});
});

describe('buildAppInputs', () => {
	test('resolves references and splits env from secrets', () => {
		const [input] = buildAppInputs(planInput(), targets, name => `postgresql://app:pw@${name}:5432/app`);
		expect(input?.type).toBe('public-repo');
		if (input?.type !== 'public-repo') throw new Error('unexpected type');
		expect(input.config.rootDirectory).toBe('apps/web');
		expect(input.config.watchPaths).toEqual(['apps/web', 'packages/ui']);
		expect(input.config.defaultDomainEnabled).toBe(true);
		expect(input.config.env).toEqual([
			{ key: 'API_URL', value: `http://${internalServiceName('22222222-2222-4222-8222-222222222222')}:8080` },
			{ key: 'LOG_LEVEL', value: 'info' }
		]);
		expect(input.config.secrets).toEqual([{ key: 'DATABASE_URL', value: 'postgresql://app:pw@db:5432/app' }]);
	});

	test('rejects references to unknown services, non-databases, and port-less services', () => {
		const withRef = (service: string, kind: 'url' | 'publicUrl' | 'connectionUri') =>
			planInput({ env: [{ key: 'X', value: null, secret: false, reference: { service, kind } }] });
		expect(() => buildAppInputs(withRef('missing', 'url'), targets, () => '')).toThrow('invalid_plan');
		expect(() => buildAppInputs(withRef('api', 'connectionUri'), targets, () => '')).toThrow('invalid_plan');
		expect(() => buildAppInputs(withRef('worker', 'url'), targets, () => '')).toThrow('invalid_plan');
		expect(() => buildAppInputs(withRef('worker', 'publicUrl'), targets, () => '')).toThrow('invalid_plan');
	});

	test('resolves public URLs, applies a custom domain, and generates random secrets', () => {
		const [input] = buildAppInputs(
			fillGeneratedSecrets(
				planInput({
					domain: 'shop.example.com',
					env: [
						{ key: 'NUXT_PUBLIC_API_BASE', value: null, secret: false, reference: { service: 'api', kind: 'publicUrl' } },
						{ key: 'JWT_SECRET', value: null, secret: true, generate: true, reference: null },
						{ key: 'SESSION_KEY', value: 'from-user', secret: true, generate: true, reference: null }
					]
				})
			),
			targets,
			() => ''
		);
		if (input?.type !== 'public-repo') throw new Error('unexpected type');
		expect(input.config.env).toEqual([{ key: 'NUXT_PUBLIC_API_BASE', value: 'https://api.example.com' }]);
		expect(input.config.domains).toEqual([{ host: 'shop.example.com', port: 3000 }]);
		expect(input.config.defaultDomainEnabled).toBe(false);
		const secrets = Object.fromEntries(input.config.secrets.map(entry => [entry.key, entry.value]));
		expect(secrets.JWT_SECRET).toMatch(/^[0-9a-f]{32}$/);
		expect(secrets.SESSION_KEY).toBe('from-user');
	});

	test('builds image services and lets apps copy their generated credentials', () => {
		const input = fillGeneratedSecrets(
			createServicesFromPlanSchema.parse({
				...planInput(),
				services: [
					{
						...planInput().services[0],
						env: [
							{ key: 'S3_ENDPOINT', value: null, secret: false, reference: { service: 'minio', kind: 'url' } },
							{ key: 'S3_SECRET_KEY', value: null, secret: true, reference: { service: 'minio', kind: 'env', key: 'MINIO_ROOT_PASSWORD' } }
						]
					}
				],
				images: [
					{
						name: 'minio',
						image: 'minio/minio',
						tag: 'RELEASE.2025-04-22T22-12-26Z',
						containerPort: 9000,
						args: ['server', '/data', '--console-address', ':9001'],
						volumes: [{ name: 'data', mountPath: '/data', size: '5Gi' }],
						publicDomain: false,
						env: [
							{ key: 'MINIO_ROOT_USER', value: 'recipe', secret: false, reference: null },
							{ key: 'MINIO_ROOT_PASSWORD', value: null, secret: true, generate: true, reference: null }
						]
					}
				]
			})
		);
		const imageTargets = new Map(targets);
		imageTargets.set('minio', {
			id: '55555555-5555-4555-8555-555555555555',
			engine: null,
			port: 9000,
			publicUrl: null,
			env: literalEnv(input.images[0]!.env)
		});

		const [minio] = buildImageInputs(input, imageTargets, () => '');
		if (minio?.type !== 'docker-image') throw new Error('unexpected type');
		expect(minio.config.args).toEqual(['server', '/data', '--console-address', ':9001']);
		expect(minio.config.volumes).toEqual([{ name: 'data', mountPath: '/data', size: '5Gi' }]);
		const password = minio.config.secrets.find(entry => entry.key === 'MINIO_ROOT_PASSWORD')?.value;
		expect(password).toMatch(/^[0-9a-f]{32}$/);

		const [app] = buildAppInputs(input, imageTargets, () => '');
		if (app?.type !== 'public-repo') throw new Error('unexpected type');
		expect(app.config.env).toEqual([{ key: 'S3_ENDPOINT', value: `http://${internalServiceName('55555555-5555-4555-8555-555555555555')}:9000` }]);
		expect(app.config.secrets).toEqual([{ key: 'S3_SECRET_KEY', value: password! }]);
	});

	test('rejects env references to keys the target does not have', () => {
		const input = planInput({ env: [{ key: 'X', value: null, secret: false, reference: { service: 'api', kind: 'env', key: 'NOPE' } }] });
		expect(() => buildAppInputs(input, targets, () => '')).toThrow('invalid_plan');
	});

	test('rejects paths the create schema would refuse', () => {
		expect(() => buildAppInputs(planInput({ rootDirectory: '../outside' }), targets, () => '')).toThrow('invalid_plan');
	});

	test('normalizes repo-relative paths', () => {
		expect(normalizeRepoPath('./apps/api/')).toBe('apps/api');
		expect(normalizeRepoPath('.')).toBeUndefined();
		expect(normalizeRepoPath('')).toBeUndefined();
		expect(normalizeRepoPath(null)).toBeUndefined();
	});
});

describe('AI settings schema', () => {
	test('requires a base URL for OpenAI-compatible endpoints and a model when enabled', () => {
		expect(updateAiSettingsSchema.safeParse({ enabled: true, provider: 'openai-compatible', model: 'llama3' }).success).toBe(false);
		expect(updateAiSettingsSchema.safeParse({ enabled: true, provider: 'anthropic', model: '' }).success).toBe(false);
		expect(updateAiSettingsSchema.safeParse({ enabled: true, provider: 'anthropic', model: 'claude-opus-5:high' }).success).toBe(true);
		expect(updateAiSettingsSchema.safeParse({ enabled: false, provider: 'openai-compatible', model: '' }).success).toBe(true);
	});
});
