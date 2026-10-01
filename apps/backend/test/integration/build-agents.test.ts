import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AgentTask, BuildPayload } from '@kubwave/build-protocol';
import type * as DatabaseModule from '@kubwave/db';
import type * as RunsModule from '~/shared/builds/runs';
import type { BuildSettings } from '~/shared/builds/settings';

const testUrl = process.env.BUILD_AGENT_TEST_DATABASE_URL;
const originalUrl = process.env.DATABASE_URL;
let database: typeof DatabaseModule;
let runs: typeof RunsModule;
let app: NestFastifyApplication;
let adminToken: string;
let serviceId: string;
let settings: BuildSettings;
let deploymentId: string;
let teamId: string;

describe.skipIf(!testUrl)('build agent protocol with PostgreSQL', () => {
	beforeAll(async () => {
		if (!new URL(testUrl!).pathname.endsWith('_test')) throw new Error('Use a dedicated database ending in _test');
		process.env.DATABASE_URL = testUrl;
		process.env.JWT_SECRET ??= 'build-agent-integration-secret';
		process.env.SECRETS_KEY ??= 'build-agent-integration-encryption';
		process.env.AUTH_RATE_LIMIT = '0';
		database = await import('@kubwave/db');
		await database.runMigrations();
		runs = await import('~/shared/builds/runs');
		settings = (await import('~/shared/builds/settings')).resolveBuildSettings(null);
		const { createApiApp } = await import('../../src/app.factory');
		app = await createApiApp();
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
		const { TokenService } = await import('~/shared/auth/token.service');
		const [admin] = await database.db
			.insert(database.users)
			.values({ name: 'Build test admin', email: `build-${crypto.randomUUID()}@example.test`, password: 'unused', isAdmin: true })
			.returning();
		adminToken = await app.get(TokenService).signAccessToken(admin!.id);
		const [team] = await database.db
			.insert(database.teams)
			.values({ name: `Build test ${crypto.randomUUID()}` })
			.returning();
		teamId = team!.id;
		const [project] = await database.db.insert(database.projects).values({ teamId, name: 'Build test' }).returning();
		const [environment] = await database.db.insert(database.environments).values({ projectId: project!.id, name: 'test' }).returning();
		const [service] = await database.db
			.insert(database.services)
			.values({
				environmentId: environment!.id,
				name: 'test',
				type: 'dockerfile',
				config: { dockerfile: 'FROM alpine:3.22', containerPort: null, env: [], domains: [], volumes: [] }
			})
			.returning();
		serviceId = service!.id;
	});

	beforeEach(async () => {
		await database.sql`truncate build_runs, build_agents`;
		await database.db.delete(database.settings);
		await database.sql`update deployments set status = 'succeeded' where service_id = ${serviceId}`;
		const [deployment] = await database.db
			.insert(database.deployments)
			.values({
				serviceId,
				type: 'dockerfile',
				config: { dockerfile: 'FROM alpine:3.22', containerPort: null, env: [], domains: [], volumes: [] },
				status: 'deploying'
			})
			.returning();
		deploymentId = deployment!.id;
	});

	afterAll(async () => {
		if (database) {
			await database.sql`delete from teams where id = ${teamId}`;
			await database.sql.end();
		}
		await app?.close();
		process.env.DATABASE_URL = originalUrl;
	});

	async function request(path: string, body?: object, token?: string, method: 'POST' | 'GET' | 'PUT' = 'POST') {
		return app.inject({ method, url: `/api/${path}`, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
	}

	async function registeredAgent() {
		const registration = await request('platform/build-agents', { name: 'test-server', maxConcurrentBuilds: 1 }, adminToken);
		expect(registration.statusCode).toBe(200);
		const command = registration.json().installCommand as string;
		const enrollment = command.match(/KUBWAVE_REGISTRATION_TOKEN='([^']+)'/)![1]!;
		const response = await request('build-agent/register', { token: enrollment });
		expect(response.statusCode).toBe(200);
		const credentials = response.json() as { id: string; token: string };
		await request(
			'build-agent/heartbeat',
			{ protocolVersion: 1, version: 'test', architecture: 'amd64', cpus: 4, memoryBytes: 8e9, freeDiskBytes: 20e9, dockerReady: true, tasks: [] },
			credentials.token
		);
		return { ...credentials, enrollment };
	}

	async function readyTask(agentId: string): Promise<string> {
		const { encryptSecret } = await import('@kubwave/crypto');
		const payload: BuildPayload = {
			job: { spec: { template: { spec: { containers: [{ name: 'builder', image: 'builder' }] } } } },
			files: {},
			redactions: ['private-test-token'],
			imageRef: 'registry/test:attempt-1'
		};
		const [run] = await database.db
			.insert(database.buildRuns)
			.values({
				deploymentId,
				settings,
				execution: 'agent',
				agentId,
				status: 'ready',
				imageRef: payload.imageRef,
				payloadCiphertext: encryptSecret(JSON.stringify(payload)),
				leaseExpiresAt: new Date(Date.now() + 90_000)
			})
			.returning();
		return run!.id;
	}

	test('registration is one-time and machine tokens cannot access admin settings', async () => {
		const agent = await registeredAgent();
		expect((await request('build-agent/register', { token: agent.enrollment })).statusCode).toBe(401);
		expect((await request('platform/settings/builds', undefined, agent.token, 'GET')).statusCode).toBe(401);
		expect((await request('build-agent/claim', {}, adminToken)).statusCode).toBe(401);
		const list = await request('platform/build-agents', undefined, adminToken, 'GET');
		expect(list.json()[0].status).toBe('online');
		expect(JSON.stringify(list.json())).not.toContain(agent.token);
	});

	test('only one concurrent claim owns the task; logs and completion are idempotent', async () => {
		const agent = await registeredAgent();
		const id = await readyTask(agent.id);
		const claims = await Promise.all([request('build-agent/claim', {}, agent.token), request('build-agent/claim', {}, agent.token)]);
		const tasks = claims.map(response => response.json().task as AgentTask | null).filter((task): task is AgentTask => Boolean(task));
		expect(tasks).toHaveLength(1);
		const task = tasks[0]!;
		const report = { attempt: task.attempt, leaseToken: task.leaseToken };
		const logs = {
			...report,
			lines: [{ sequence: 0, container: 'builder', ts: new Date().toISOString(), message: 'private-test-token should be hidden' }]
		};
		expect((await request(`build-agent/tasks/${id}/logs`, logs, agent.token)).statusCode).toBe(200);
		await request(`build-agent/tasks/${id}/logs`, logs, agent.token);
		const rows = await database.sql`select message from deployment_logs where deployment_id = ${deploymentId}`;
		expect(rows).toHaveLength(1);
		expect(rows[0]!.message).toBe('[REDACTED] should be hidden');
		expect((await request(`build-agent/tasks/${id}/result`, { ...report, success: true }, agent.token)).statusCode).toBe(200);
		expect((await request(`build-agent/tasks/${id}/result`, { ...report, success: true }, agent.token)).statusCode).toBe(200);
		const row = await runs.getBuildRun(deploymentId);
		expect(row?.status).toBe('succeeded');
		expect(row?.payloadCiphertext).toBeNull();
	});

	test('cancellation and expired attempts reject late success', async () => {
		const agent = await registeredAgent();
		const id = await readyTask(agent.id);
		const task = (await request('build-agent/claim', {}, agent.token)).json().task as AgentTask;
		await runs.cancelBuildRun(deploymentId);
		expect(
			(await request(`build-agent/tasks/${id}/result`, { attempt: task.attempt, leaseToken: task.leaseToken, success: true }, agent.token)).statusCode
		).toBe(409);
	});

	test('lease loss retries once with a new attempt and rejects the old lease', async () => {
		const agent = await registeredAgent();
		const id = await readyTask(agent.id);
		const task = (await request('build-agent/claim', {}, agent.token)).json().task as AgentTask;
		await database.sql`update build_runs set lease_expires_at = now() - interval '1 second' where id = ${id}`;
		await runs.maintainBuildRuns();
		const run = await runs.getBuildRun(deploymentId);
		expect(run?.status).toBe('queued');
		expect(run?.attempt).toBe(2);
		expect(run?.payloadCiphertext).toBeNull();
		expect(
			(await request(`build-agent/tasks/${id}/result`, { attempt: task.attempt, leaseToken: task.leaseToken, success: true }, agent.token)).statusCode
		).toBe(409);
	});

	test('cluster capacity is atomic across simultaneous workers and settings are snapshotted', async () => {
		await database.db.insert(database.settings).values({ key: 'build_settings', value: { ...settings, maxConcurrentBuilds: 1, memoryLimit: '6Gi' } });
		const first = await runs.ensureBuildRun(deploymentId);
		const [otherDeployment] = await database.db
			.insert(database.deployments)
			.values({
				serviceId,
				type: 'dockerfile',
				config: { dockerfile: 'FROM alpine:3.22', containerPort: null, env: [], domains: [], volumes: [] },
				status: 'deploying'
			})
			.returning();
		const second = await runs.ensureBuildRun(otherDeployment!.id);
		const reserved = await Promise.all([runs.reserveBuildRun(first, 'amd64'), runs.reserveBuildRun(second, 'amd64')]);
		expect(reserved.filter(Boolean)).toHaveLength(1);
		await database.db.update(database.settings).set({ value: { ...settings, memoryLimit: '8Gi' } });
		expect((await runs.getBuildRun(deploymentId))?.settings.memoryLimit).toBe('6Gi');
	});
	test('completed builds acquire deployment capacity atomically before applying manifests', async () => {
		const { reserveBuildDeployment } = await import('~/modules/worker/jobs/deployments/builds/promotion');
		await database.db.insert(database.settings).values({ key: 'deployment-concurrency', value: { maxConcurrentDeployments: 1 } });
		await database.sql`update deployments set phase = 'building' where id = ${deploymentId}`;
		const [other] = await database.db
			.insert(database.deployments)
			.values({
				serviceId,
				type: 'dockerfile',
				config: { dockerfile: 'FROM alpine:3.22', containerPort: null, env: [], domains: [], volumes: [] },
				status: 'deploying',
				phase: 'build-queued'
			})
			.returning();
		const results = await Promise.all([reserveBuildDeployment(deploymentId), reserveBuildDeployment(other!.id)]);
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	test('source checkpoint survives retry and cannot change within an attempt', async () => {
		const agent = await registeredAgent();
		const id = await readyTask(agent.id);
		const task = (await request('build-agent/claim', {}, agent.token)).json().task as AgentTask;
		const report = { attempt: task.attempt, leaseToken: task.leaseToken, commit: 'a'.repeat(40) };
		expect((await request(`build-agent/tasks/${id}/source`, report, agent.token)).statusCode).toBe(200);
		expect((await request(`build-agent/tasks/${id}/source`, { ...report, commit: 'b'.repeat(40) }, agent.token)).statusCode).toBe(409);
		await database.sql`update build_runs set lease_expires_at = now() - interval '1 second' where id = ${id}`;
		await runs.maintainBuildRuns();
		expect((await runs.getBuildRun(deploymentId))?.sourceCommit).toBe(report.commit);
	});

	test('paused servers cannot claim; revocation invalidates credentials and fails active builds', async () => {
		const agent = await registeredAgent();
		await readyTask(agent.id);
		await request(`platform/build-agents/${agent.id}`, { paused: true, maxConcurrentBuilds: 1 }, adminToken, 'PUT');
		expect((await request('build-agent/claim', {}, agent.token)).json().task).toBeNull();
		await request(`platform/build-agents/${agent.id}`, { paused: false, maxConcurrentBuilds: 1 }, adminToken, 'PUT');
		expect((await request('build-agent/claim', {}, agent.token)).json().task).not.toBeNull();
		await request(`platform/build-agents/${agent.id}/revoke`, {}, adminToken);
		expect((await runs.getBuildRun(deploymentId))?.status).toBe('failed');
		expect((await request('build-agent/claim', {}, agent.token)).statusCode).toBe(401);
	});
	test('cluster fallback is limited to builds that have never started an external attempt', async () => {
		await database.db
			.insert(database.settings)
			.values({ key: 'build_settings', value: { ...settings, execution: 'agent', fallbackToCluster: true } });
		const run = await runs.ensureBuildRun(deploymentId);
		await database.sql`update build_runs set attempt = 2, created_at = now() - interval '2 minutes' where id = ${run.id}`;
		expect(await runs.reserveBuildRun(run, 'amd64')).toBeNull();
		await database.sql`update build_runs set attempt = 1 where id = ${run.id}`;
		expect((await runs.reserveBuildRun(run, 'amd64'))?.execution).toBe('cluster');
	});
});
