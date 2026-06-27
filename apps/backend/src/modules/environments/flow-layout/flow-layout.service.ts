import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql as drizzleSql } from 'drizzle-orm';
import { db, serviceFlowNodes, services } from '@kubwave/db';
import type { ServiceFlowNode } from '@kubwave/db';
import { EnvironmentsService } from '../environments.service.js';
import { ServiceNotFoundError } from '../../services/services.errors.js';
import type { FlowLayoutDto, FlowLayoutNodeDto, UpdateFlowLayoutNodeInput } from './flow-layout.dto.js';
import { FlowLayoutConflictError } from './flow-layout.errors.js';
import { publishFlowLayoutEvent } from './flow-layout.realtime.js';

function toNodeView(row: Pick<ServiceFlowNode, 'serviceId' | 'x' | 'y' | 'revision' | 'updatedAt'>): FlowLayoutNodeDto {
	return {
		serviceId: row.serviceId,
		position: { x: row.x, y: row.y },
		revision: row.revision,
		updatedAt: row.updatedAt.toISOString()
	};
}

function isUniqueViolation(err: unknown): boolean {
	return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

@Injectable()
export class FlowLayoutService {
	constructor(private readonly environments: EnvironmentsService) {}

	async getEnvironmentFlowLayout(actingUserId: string, environmentId: string): Promise<FlowLayoutDto> {
		const environment = await this.environments.loadEnvironmentForUser(actingUserId, environmentId);
		const rows = await db
			.select({
				serviceId: serviceFlowNodes.serviceId,
				x: serviceFlowNodes.x,
				y: serviceFlowNodes.y,
				revision: serviceFlowNodes.revision,
				updatedAt: serviceFlowNodes.updatedAt
			})
			.from(serviceFlowNodes)
			.innerJoin(services, and(eq(services.id, serviceFlowNodes.serviceId), eq(services.environmentId, environment.id)))
			.where(eq(serviceFlowNodes.environmentId, environment.id))
			.orderBy(asc(services.createdAt), asc(services.id));

		return { nodes: rows.map(toNodeView) };
	}

	async updateEnvironmentFlowNode(
		actingUserId: string,
		environmentId: string,
		serviceId: string,
		input: UpdateFlowLayoutNodeInput
	): Promise<FlowLayoutNodeDto> {
		const environment = await this.environments.loadEnvironmentForUser(actingUserId, environmentId);
		await this.assertServiceInEnvironment(environment.id, serviceId);

		const now = new Date();
		let updated: ServiceFlowNode | undefined;

		if (input.baseRevision === null) {
			try {
				[updated] = await db
					.insert(serviceFlowNodes)
					.values({
						environmentId: environment.id,
						serviceId,
						x: input.position.x,
						y: input.position.y,
						revision: 1,
						updatedByUserId: actingUserId,
						updatedAt: now
					})
					.returning();
			} catch (err) {
				if (isUniqueViolation(err)) throw new FlowLayoutConflictError(await this.currentNode(environment.id, serviceId));
				throw err;
			}
		} else {
			[updated] = await db
				.update(serviceFlowNodes)
				.set({
					x: input.position.x,
					y: input.position.y,
					revision: drizzleSql`${serviceFlowNodes.revision} + 1`,
					updatedByUserId: actingUserId,
					updatedAt: now
				})
				.where(
					and(
						eq(serviceFlowNodes.environmentId, environment.id),
						eq(serviceFlowNodes.serviceId, serviceId),
						eq(serviceFlowNodes.revision, input.baseRevision)
					)
				)
				.returning();
		}

		if (!updated) throw new FlowLayoutConflictError(await this.currentNode(environment.id, serviceId));

		const view = toNodeView(updated);
		void publishFlowLayoutEvent({
			type: 'node_position_updated',
			environmentId: environment.id,
			serviceId: view.serviceId,
			position: view.position,
			revision: view.revision,
			updatedAt: view.updatedAt,
			clientMutationId: input.clientMutationId
		}).catch(err => {
			console.warn('[flow-layout] notify failed', err);
		});

		return view;
	}

	private async assertServiceInEnvironment(environmentId: string, serviceId: string): Promise<void> {
		const [row] = await db
			.select({ id: services.id })
			.from(services)
			.where(and(eq(services.id, serviceId), eq(services.environmentId, environmentId)))
			.limit(1);

		if (!row) throw new ServiceNotFoundError();
	}

	private async currentNode(environmentId: string, serviceId: string): Promise<FlowLayoutNodeDto | null> {
		const [row] = await db
			.select()
			.from(serviceFlowNodes)
			.where(and(eq(serviceFlowNodes.environmentId, environmentId), eq(serviceFlowNodes.serviceId, serviceId)))
			.limit(1);

		return row ? toNodeView(row) : null;
	}
}
