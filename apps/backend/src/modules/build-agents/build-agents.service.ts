import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, gt, sql, asc } from 'drizzle-orm';
import { db, buildAgents, buildRuns, deploymentLogs, type BuildRun } from '@kubwave/db';
import { decryptSecret } from '@kubwave/crypto';
import { AGENT_LEASE_SECONDS, BUILD_PROTOCOL_VERSION, redactBuildLog, type AgentTask, type BuildPayload } from '@kubwave/build-protocol';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { ACTIVE_BUILD_STATES } from '../../shared/builds/runs.js';
import { agentAvailable } from '../../shared/builds/execution.js';
import type { z } from 'zod';
import type { heartbeatSchema, taskLogsSchema, taskResultSchema, taskSourceSchema } from './build-agents.dto.js';
import type { BuildAgentDto, CreateBuildAgentDto, UpdateBuildAgentDto } from './build-agents.dto.js';

export const hashAgentToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const deploymentActive = sql`exists (select 1 from deployments d where d.id = ${buildRuns.deploymentId} and d.status in ('pending', 'deploying'))`;

@Injectable()
export class BuildAgentsService {
	constructor(private readonly config: BackendConfigService) {}

	async list(): Promise<BuildAgentDto[]> {
		const [agents, active] = await Promise.all([
			db.select().from(buildAgents).orderBy(asc(buildAgents.createdAt)),
			db
				.select()
				.from(buildRuns)
				.where(inArray(buildRuns.status, [...ACTIVE_BUILD_STATES]))
		]);
		return agents.map(agent => ({
			id: agent.id,
			name: agent.name,
			paused: agent.paused,
			maxConcurrentBuilds: agent.maxConcurrentBuilds,
			status: agent.revoked
				? 'revoked'
				: !agent.tokenHash
					? 'pending'
					: agent.paused
						? 'paused'
						: agent.protocolVersion !== BUILD_PROTOCOL_VERSION
							? 'incompatible'
							: !agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() >= AGENT_LEASE_SECONDS * 1000
								? 'offline'
								: !agent.capabilities?.dockerReady || agent.capabilities.freeDiskBytes <= 1024 ** 3
									? 'unavailable'
									: 'online',
			lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
			version: agent.version,
			architecture: agent.architecture,
			activeBuilds: active.filter(run => run.agentId === agent.id).length,
			cpus: agent.capabilities?.cpus ?? null,
			memoryBytes: agent.capabilities?.memoryBytes ?? null,
			freeDiskBytes: agent.capabilities?.freeDiskBytes ?? null
		}));
	}

	async create(input: CreateBuildAgentDto) {
		const token = newToken();
		const expiresAt = new Date(Date.now() + 30 * 60_000);
		const url = new URL(this.config.api.appBaseUrl);
		if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', 'console.localhost'].includes(url.hostname))
			throw new ApiError(400, 'agent_requires_https');
		const version = this.config.api.appVersion;
		if (!/^[a-zA-Z0-9_.-]+$/.test(version)) throw new ApiError(400, 'invalid_agent_image_version');
		const [agent] = await db
			.insert(buildAgents)
			.values({ ...input, registrationHash: hashAgentToken(token), registrationExpiresAt: expiresAt })
			.returning();
		return {
			id: agent!.id,
			expiresAt: expiresAt.toISOString(),
			installCommand: `docker run -d --name kubwave-build-agent --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock -v kubwave-build-agent:/var/lib/kubwave-agent -e KUBWAVE_URL=${shellQuote(url.origin)} -e KUBWAVE_REGISTRATION_TOKEN=${shellQuote(token)} ghcr.io/kubwave/build-agent:${version}`
		};
	}

	async update(id: string, input: UpdateBuildAgentDto) {
		const rows = await db
			.update(buildAgents)
			.set(input)
			.where(and(eq(buildAgents.id, id), eq(buildAgents.revoked, false)))
			.returning();
		if (!rows.length) throw new ApiError(404, 'build_agent_not_found');
		return { ok: true };
	}

	async revoke(id: string) {
		await db.transaction(async tx => {
			await tx.execute(sql`select pg_advisory_xact_lock(73162411)`);
			const rows = await tx
				.update(buildAgents)
				.set({ revoked: true, tokenHash: null, registrationHash: null })
				.where(eq(buildAgents.id, id))
				.returning();
			if (!rows.length) throw new ApiError(404, 'build_agent_not_found');
			await tx
				.update(buildRuns)
				.set({ status: 'failed', lastError: 'Build server access revoked.', payloadCiphertext: null, leaseTokenHash: null, finishedAt: new Date() })
				.where(and(eq(buildRuns.agentId, id), inArray(buildRuns.status, [...ACTIVE_BUILD_STATES])));
		});
		return { ok: true };
	}

	async remove(id: string) {
		await db.transaction(async tx => {
			await tx.execute(sql`select pg_advisory_xact_lock(73162411)`);
			const active = await tx
				.select({ id: buildRuns.id })
				.from(buildRuns)
				.where(and(eq(buildRuns.agentId, id), inArray(buildRuns.status, [...ACTIVE_BUILD_STATES])))
				.limit(1);
			if (active.length) throw new ApiError(409, 'build_agent_has_active_builds');
			await tx.delete(buildAgents).where(eq(buildAgents.id, id));
		});
		return { ok: true };
	}

	async register(token: string) {
		const credential = newToken();
		const [agent] = await db
			.update(buildAgents)
			.set({ tokenHash: hashAgentToken(credential), registrationHash: null, registrationExpiresAt: null })
			.where(
				and(
					eq(buildAgents.registrationHash, hashAgentToken(token)),
					gt(buildAgents.registrationExpiresAt, new Date()),
					eq(buildAgents.revoked, false)
				)
			)
			.returning();
		if (!agent) throw new ApiError(401, 'invalid_build_agent_registration');
		return { id: agent.id, token: credential };
	}

	async authenticate(token: string): Promise<string> {
		if (token.length > 200) throw new ApiError(401, 'invalid_build_agent_token');
		const [agent] = await db
			.select({ id: buildAgents.id })
			.from(buildAgents)
			.where(and(eq(buildAgents.tokenHash, hashAgentToken(token)), eq(buildAgents.revoked, false)))
			.limit(1);
		if (!agent) throw new ApiError(401, 'invalid_build_agent_token');
		return agent.id;
	}

	async heartbeat(id: string, input: z.infer<typeof heartbeatSchema>) {
		const leaseExpiresAt = new Date(Date.now() + AGENT_LEASE_SECONDS * 1000);
		await db
			.update(buildAgents)
			.set({
				lastSeenAt: new Date(),
				protocolVersion: input.protocolVersion,
				architecture: input.architecture,
				version: input.version,
				capabilities: { cpus: input.cpus, memoryBytes: input.memoryBytes, freeDiskBytes: input.freeDiskBytes, dockerReady: input.dockerReady }
			})
			.where(and(eq(buildAgents.id, id), eq(buildAgents.revoked, false)));
		const canceled: string[] = [];
		for (const task of input.tasks) {
			const updated = await db
				.update(buildRuns)
				.set({ leaseExpiresAt })
				.where(
					and(
						this.taskOwnership(id, task.id, task.attempt, task.leaseToken),
						eq(buildRuns.status, 'running'),
						deploymentActive,
						sql`${buildRuns.startedAt} + (${buildRuns.settings}->>'timeoutSeconds')::int * interval '1 second' > now()`
					)
				)
				.returning({ id: buildRuns.id });
			if (!updated.length) canceled.push(task.id);
		}
		return { leaseExpiresAt: leaseExpiresAt.toISOString(), canceled };
	}

	async claim(id: string): Promise<{ task: AgentTask | null }> {
		return db.transaction(async tx => {
			await tx.execute(sql`select pg_advisory_xact_lock(73162411)`);
			const [agent] = await tx.select().from(buildAgents).where(eq(buildAgents.id, id));
			if (!agent || !agentAvailable(agent, agent.architecture ?? '')) return { task: null };
			const [run] = await tx
				.select()
				.from(buildRuns)
				.where(and(eq(buildRuns.agentId, id), eq(buildRuns.status, 'ready'), gt(buildRuns.leaseExpiresAt, new Date()), deploymentActive))
				.orderBy(asc(buildRuns.createdAt))
				.limit(1)
				.for('update', { skipLocked: true });
			if (!run?.payloadCiphertext) return { task: null };
			const running = await tx
				.select({ id: buildRuns.id })
				.from(buildRuns)
				.where(and(eq(buildRuns.agentId, id), eq(buildRuns.status, 'running')));
			if (running.length >= agent.maxConcurrentBuilds) return { task: null };
			const leaseToken = newToken();
			const leaseExpiresAt = new Date(Date.now() + AGENT_LEASE_SECONDS * 1000);
			await tx
				.update(buildRuns)
				.set({ status: 'running', startedAt: new Date(), leaseTokenHash: hashAgentToken(leaseToken), leaseExpiresAt })
				.where(eq(buildRuns.id, run.id));
			const payload = JSON.parse(decryptSecret(run.payloadCiphertext)) as BuildPayload;
			return {
				task: {
					...payload,
					id: run.id,
					attempt: run.attempt,
					leaseToken,
					leaseExpiresAt: leaseExpiresAt.toISOString(),
					timeoutSeconds: run.settings.timeoutSeconds
				}
			};
		});
	}

	private taskOwnership(agentId: string, id: string, attempt: number, leaseToken: string) {
		return and(
			eq(buildRuns.id, id),
			eq(buildRuns.agentId, agentId),
			eq(buildRuns.attempt, attempt),
			eq(buildRuns.leaseTokenHash, hashAgentToken(leaseToken)),
			gt(buildRuns.leaseExpiresAt, new Date())
		);
	}

	private async activeTask(agentId: string, id: string, attempt: number, leaseToken: string): Promise<BuildRun> {
		const [run] = await db
			.select()
			.from(buildRuns)
			.where(and(this.taskOwnership(agentId, id, attempt, leaseToken), eq(buildRuns.status, 'running'), deploymentActive))
			.limit(1);
		if (!run) throw new ApiError(409, 'build_attempt_expired');
		return run;
	}

	async logs(agentId: string, id: string, input: z.infer<typeof taskLogsSchema>) {
		const run = await this.activeTask(agentId, id, input.attempt, input.leaseToken);
		const redactions = run.payloadCiphertext ? (JSON.parse(decryptSecret(run.payloadCiphertext)) as BuildPayload).redactions : [];
		if (input.lines.length)
			await db
				.insert(deploymentLogs)
				.values(
					input.lines.map(line => ({
						deploymentId: run.deploymentId,
						kind: 'build-output' as const,
						level: 'info' as const,
						step: 'build-output',
						message: redactBuildLog(line.message, redactions),
						containerName: `agent-${run.attempt}-${line.container}`,
						sourceTs: new Date(0),
						lineHash: String(line.sequence),
						ts: new Date(line.ts)
					}))
				)
				.onConflictDoNothing();
		return { ok: true };
	}

	async source(agentId: string, id: string, input: z.infer<typeof taskSourceSchema>) {
		const rows = await db
			.update(buildRuns)
			.set({ sourceCommit: input.commit })
			.where(
				and(
					this.taskOwnership(agentId, id, input.attempt, input.leaseToken),
					eq(buildRuns.status, 'running'),
					deploymentActive,
					sql`(${buildRuns.sourceCommit} is null or ${buildRuns.sourceCommit} = ${input.commit})`
				)
			)
			.returning({ id: buildRuns.id });
		if (!rows.length) throw new ApiError(409, 'build_attempt_expired');
		return { ok: true };
	}

	async result(agentId: string, id: string, input: z.infer<typeof taskResultSchema>) {
		const [completed] = await db
			.select()
			.from(buildRuns)
			.where(
				and(
					eq(buildRuns.id, id),
					eq(buildRuns.agentId, agentId),
					eq(buildRuns.attempt, input.attempt),
					eq(buildRuns.leaseTokenHash, hashAgentToken(input.leaseToken)),
					eq(buildRuns.status, input.success ? 'succeeded' : 'failed')
				)
			)
			.limit(1);
		if (completed) return { ok: true };
		const run = await this.activeTask(agentId, id, input.attempt, input.leaseToken);
		const redactions = run.payloadCiphertext ? (JSON.parse(decryptSecret(run.payloadCiphertext)) as BuildPayload).redactions : [];
		const rows = await db
			.update(buildRuns)
			.set({
				status: input.success ? 'succeeded' : 'failed',
				lastError: input.success ? null : redactBuildLog(input.error ?? 'External build failed.', redactions),
				finishedAt: new Date(),
				payloadCiphertext: null
			})
			.where(and(this.taskOwnership(agentId, id, input.attempt, input.leaseToken), eq(buildRuns.status, 'running'), deploymentActive))
			.returning({ id: buildRuns.id });
		if (!rows.length) throw new ApiError(409, 'build_attempt_expired');
		return { ok: true };
	}
}
