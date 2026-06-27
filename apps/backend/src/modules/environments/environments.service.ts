import { Injectable } from '@nestjs/common';
import { and, count, eq, ne } from 'drizzle-orm';
import { db, environments, projects, services, teamMembers } from '@kubwave/db';
import { ProjectNotFoundError } from '../projects/projects.errors.js';
import type { CreateEnvironmentInput, EnvironmentDto, UpdateEnvironmentInput } from './environments.dto.js';
import {
	EnvironmentNameTakenError,
	EnvironmentNotFoundError,
	LastEnvironmentError,
	PreviewEnvironmentImmutableError
} from './environments.errors.js';

interface EnvironmentRow {
	id: string;
	projectId: string;
	name: string;
	kind: 'persistent' | 'preview';
	prPreviewsEnabled: boolean;
	prNumber: number | null;
	prRepoUrl: string | null;
	baseEnvironmentId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface LoadedEnvironment extends EnvironmentRow {
	teamId: string;
}

function toEnvironmentView(row: EnvironmentRow & { serviceCount: number }): EnvironmentDto {
	return {
		id: row.id,
		projectId: row.projectId,
		name: row.name,
		kind: row.kind,
		prPreviewsEnabled: row.prPreviewsEnabled,
		prNumber: row.prNumber,
		prRepoUrl: row.prRepoUrl,
		baseEnvironmentId: row.baseEnvironmentId,
		serviceCount: Number(row.serviceCount),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

@Injectable()
export class EnvironmentsService {
	async createEnvironment(actingUserId: string, projectId: string, input: CreateEnvironmentInput): Promise<EnvironmentDto> {
		const project = await this.loadProjectForUser(actingUserId, projectId);
		const name = input.name.trim();

		if (await this.environmentNameTaken(project.id, name)) {
			throw new EnvironmentNameTakenError();
		}

		const [environment] = await db.insert(environments).values({ projectId: project.id, name, kind: 'persistent' }).returning();
		if (!environment) throw new Error('failed to create environment');

		return toEnvironmentView({ ...environment, serviceCount: 0 });
	}

	async updateEnvironment(actingUserId: string, environmentId: string, input: UpdateEnvironmentInput): Promise<EnvironmentDto> {
		const environment = await this.loadEnvironmentForUser(actingUserId, environmentId);

		if (environment.kind === 'preview') {
			throw new PreviewEnvironmentImmutableError();
		}

		const values: { name?: string; prPreviewsEnabled?: boolean; updatedAt: Date } = { updatedAt: new Date() };

		if (input.name !== undefined) {
			const name = input.name.trim();
			if (name !== environment.name && (await this.environmentNameTaken(environment.projectId, name, environment.id))) {
				throw new EnvironmentNameTakenError();
			}
			values.name = name;
		}

		if (input.prPreviewsEnabled !== undefined) {
			values.prPreviewsEnabled = input.prPreviewsEnabled;
		}

		const [updated] = await db.update(environments).set(values).where(eq(environments.id, environment.id)).returning();
		if (!updated) throw new EnvironmentNotFoundError();

		return toEnvironmentView({ ...updated, serviceCount: await this.serviceCountForEnvironment(updated.id) });
	}

	async deleteEnvironment(actingUserId: string, environmentId: string): Promise<void> {
		const environment = await this.loadEnvironmentForUser(actingUserId, environmentId);

		await db.transaction(async tx => {
			const projectEnvironments = await tx
				.select({ id: environments.id })
				.from(environments)
				.where(and(eq(environments.projectId, environment.projectId), eq(environments.kind, 'persistent')))
				.for('update');

			if (environment.kind === 'persistent' && projectEnvironments.length <= 1) {
				throw new LastEnvironmentError();
			}

			await tx.delete(environments).where(eq(environments.id, environment.id));
		});
	}

	async loadEnvironmentForUser(actingUserId: string, environmentId: string): Promise<LoadedEnvironment> {
		const [row] = await db
			.select({
				id: environments.id,
				projectId: environments.projectId,
				teamId: projects.teamId,
				name: environments.name,
				kind: environments.kind,
				prPreviewsEnabled: environments.prPreviewsEnabled,
				prNumber: environments.prNumber,
				prRepoUrl: environments.prRepoUrl,
				baseEnvironmentId: environments.baseEnvironmentId,
				createdAt: environments.createdAt,
				updatedAt: environments.updatedAt
			})
			.from(environments)
			.innerJoin(projects, eq(projects.id, environments.projectId))
			.innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actingUserId)))
			.where(eq(environments.id, environmentId))
			.limit(1);

		if (!row) throw new EnvironmentNotFoundError();
		return row;
	}

	private async loadProjectForUser(actingUserId: string, projectId: string): Promise<{ id: string; teamId: string }> {
		const [row] = await db
			.select({
				id: projects.id,
				teamId: projects.teamId
			})
			.from(projects)
			.innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actingUserId)))
			.where(eq(projects.id, projectId))
			.limit(1);

		if (!row) throw new ProjectNotFoundError();
		return row;
	}

	private async environmentNameTaken(projectId: string, name: string, exceptEnvironmentId?: string): Promise<boolean> {
		const [row] = await db
			.select({ id: environments.id })
			.from(environments)
			.where(
				exceptEnvironmentId
					? and(eq(environments.projectId, projectId), eq(environments.name, name), ne(environments.id, exceptEnvironmentId))
					: and(eq(environments.projectId, projectId), eq(environments.name, name))
			)
			.limit(1);

		return Boolean(row);
	}

	private async serviceCountForEnvironment(environmentId: string): Promise<number> {
		const [row] = await db.select({ value: count() }).from(services).where(eq(services.environmentId, environmentId));
		return Number(row?.value ?? 0);
	}
}
