import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, deploymentLogs, deployments } from '@kubwave/db';
import type { Deployment, DeploymentLogEntry, DeploymentStatus } from '@kubwave/db';
import { ServiceNotFoundError } from '../services/services.errors.js';
import { ServicesService } from '../services/services.service.js';
import { toConfigView } from '../services/services.config.js';
import { DeploymentNotCancelableError, DeploymentNotFoundError } from './deployments.errors.js';
import type { DeploymentView } from './deployments.types.js';

const DEPLOYMENT_HISTORY_LIMIT = 50;

function toDeploymentView(row: Deployment): DeploymentView {
	return {
		id: row.id,
		serviceId: row.serviceId,
		type: row.type,
		status: row.status as DeploymentStatus,
		phase: row.phase,
		lastError: row.lastError,
		attempts: row.attempts,
		config: toConfigView(row.config),
		trigger: row.trigger,
		triggeredByUserId: row.triggeredByUserId,
		createdAt: row.createdAt.toISOString(),
		startedAt: row.startedAt?.toISOString() ?? null,
		finishedAt: row.finishedAt?.toISOString() ?? null
	};
}

function logEntry(level: DeploymentLogEntry['level'], step: string, message: string): DeploymentLogEntry {
	return { ts: new Date().toISOString(), level, step, message };
}

function deploymentLogRows(deploymentId: string, entries: DeploymentLogEntry[]) {
	return entries.map(entry => ({
		deploymentId,
		kind: 'event' as const,
		ts: new Date(entry.ts),
		level: entry.level,
		step: entry.step,
		message: entry.message
	}));
}

@Injectable()
export class DeploymentsService {
	constructor(private readonly services: ServicesService) {}

	async enqueueDeployment(actingUserId: string, serviceId: string): Promise<DeploymentView> {
		const service = await this.services.loadServiceForUser(actingUserId, serviceId);

		const created = await db.transaction(async tx => {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deploy:${serviceId}`}))`);
			await tx
				.update(deployments)
				.set({ status: 'superseded', finishedAt: new Date() })
				.where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'pending')));

			const [row] = await tx
				.insert(deployments)
				.values({
					serviceId,
					type: service.type,
					config: service.config,
					status: 'pending',
					trigger: 'manual',
					triggeredByUserId: actingUserId
				})
				.returning();

			if (!row) throw new Error('failed to enqueue deployment');

			await tx.insert(deploymentLogs).values(deploymentLogRows(row.id, [logEntry('info', 'queued', 'Queued')]));
			return row;
		});

		return toDeploymentView(created);
	}

	async listDeployments(actingUserId: string, serviceId: string): Promise<DeploymentView[]> {
		await this.services.loadServiceForUser(actingUserId, serviceId);

		const rows = await db
			.select()
			.from(deployments)
			.where(eq(deployments.serviceId, serviceId))
			.orderBy(desc(deployments.createdAt))
			.limit(DEPLOYMENT_HISTORY_LIMIT);

		return rows.map(toDeploymentView);
	}

	async getDeployment(actingUserId: string, deploymentId: string): Promise<DeploymentView> {
		const [row] = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
		if (!row) throw new DeploymentNotFoundError();

		await this.authorizeDeploymentAccess(actingUserId, row.serviceId);
		return toDeploymentView(row);
	}

	async listDeploymentLogs(actingUserId: string, deploymentId: string): Promise<{ logs: DeploymentLogEntry[] }> {
		const deployment = await this.loadDeploymentForLogs(actingUserId, deploymentId);

		const rows = await db
			.select({
				ts: deploymentLogs.ts,
				level: deploymentLogs.level,
				step: deploymentLogs.step,
				message: deploymentLogs.message
			})
			.from(deploymentLogs)
			.where(and(eq(deploymentLogs.deploymentId, deployment.id), eq(deploymentLogs.kind, 'event')))
			.orderBy(asc(deploymentLogs.ts));

		return { logs: rows.map(log => ({ ...log, ts: log.ts.toISOString() })) };
	}

	async getDeploymentBuildLogs(
		actingUserId: string,
		deploymentId: string
	): Promise<{ containers: Array<{ containerName: string; content: string; updatedAt: string | null }> }> {
		const deployment = await this.loadDeploymentForLogs(actingUserId, deploymentId);

		const rows = await db
			.select({
				containerName: deploymentLogs.containerName,
				message: deploymentLogs.message,
				ts: deploymentLogs.ts,
				sourceTs: deploymentLogs.sourceTs
			})
			.from(deploymentLogs)
			.where(and(eq(deploymentLogs.deploymentId, deployment.id), eq(deploymentLogs.kind, 'build-output')))
			.orderBy(asc(deploymentLogs.containerName), asc(deploymentLogs.sourceTs), asc(deploymentLogs.ts));

		const byContainer = new Map<string, { lines: string[]; updatedAt: Date | null }>();

		for (const row of rows) {
			const containerName = row.containerName ?? 'build';
			const existing = byContainer.get(containerName) ?? { lines: [], updatedAt: null };
			existing.lines.push(row.message);
			if (!existing.updatedAt || row.ts > existing.updatedAt) existing.updatedAt = row.ts;
			byContainer.set(containerName, existing);
		}

		return {
			containers: [...byContainer.entries()].map(([containerName, value]) => ({
				containerName,
				content: value.lines.join('\n'),
				updatedAt: value.updatedAt?.toISOString() ?? null
			}))
		};
	}

	async cancelDeployment(actingUserId: string, deploymentId: string): Promise<DeploymentView> {
		const [initial] = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
		if (!initial) throw new DeploymentNotFoundError();

		await this.authorizeDeploymentAccess(actingUserId, initial.serviceId);

		const canceled = await db.transaction(async tx => {
			const [current] = await tx.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1).for('update');
			if (!current) throw new DeploymentNotFoundError();

			const status = current.status as DeploymentStatus;
			const now = new Date();

			if (status === 'pending') {
				const [row] = await tx
					.update(deployments)
					.set({
						status: 'canceled',
						phase: 'canceled',
						lastError: null,
						finishedAt: now
					})
					.where(eq(deployments.id, deploymentId))
					.returning();

				if (!row) throw new Error('failed to cancel deployment');

				await tx
					.insert(deploymentLogs)
					.values(deploymentLogRows(deploymentId, [logEntry('warn', 'canceled', 'Deployment canceled before rollout started')]));
				return row;
			}

			if (status === 'deploying') {
				const [row] = await tx
					.update(deployments)
					.set({
						status: 'canceling',
						lastError: null,
						rollbackAttempts: 0
					})
					.where(eq(deployments.id, deploymentId))
					.returning();

				if (!row) throw new Error('failed to cancel deployment');

				await tx
					.insert(deploymentLogs)
					.values(deploymentLogRows(deploymentId, [logEntry('warn', 'canceling', 'Cancellation requested; restoring previous deployment')]));
				return row;
			}

			if (status === 'canceling' || status === 'canceled') {
				return current;
			}

			throw new DeploymentNotCancelableError();
		});

		return toDeploymentView(canceled);
	}

	private async loadDeploymentForLogs(actingUserId: string, deploymentId: string): Promise<{ id: string; serviceId: string }> {
		const [row] = await db
			.select({ id: deployments.id, serviceId: deployments.serviceId })
			.from(deployments)
			.where(eq(deployments.id, deploymentId))
			.limit(1);

		if (!row) throw new DeploymentNotFoundError();

		await this.authorizeDeploymentAccess(actingUserId, row.serviceId);
		return row;
	}

	private async authorizeDeploymentAccess(actingUserId: string, serviceId: string): Promise<void> {
		try {
			await this.services.loadServiceForUser(actingUserId, serviceId);
		} catch (err) {
			if (err instanceof ServiceNotFoundError) throw new DeploymentNotFoundError();
			throw err;
		}
	}
}
