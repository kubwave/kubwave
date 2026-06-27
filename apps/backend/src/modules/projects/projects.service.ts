import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { db, environments, projects, services, teamMembers } from '@kubwave/db';
import { TeamNotFoundError } from '../teams/teams.errors.js';
import { ProjectEnvironmentNotFoundError, ProjectNameTakenError, ProjectNotFoundError } from './projects.errors.js';
import type { CreateProjectInput, UpdateProjectInput, UpdateProjectPrPreviewsInput } from './projects.dto.js';

interface EnvironmentView {
	id: string;
	projectId: string;
	name: string;
	kind: 'persistent' | 'preview';
	prPreviewsEnabled: boolean;
	prNumber: number | null;
	prRepoUrl: string | null;
	baseEnvironmentId: string | null;
	serviceCount: number;
	createdAt: string;
	updatedAt: string;
}

interface ProjectListItemView {
	id: string;
	teamId: string;
	name: string;
	description: string;
	environmentCount: number;
	serviceCount: number;
	createdAt: string;
	updatedAt: string;
}

interface ProjectDetailView extends ProjectListItemView {
	environments: EnvironmentView[];
}

interface ProjectRow {
	id: string;
	teamId: string;
	name: string;
	description: string;
	createdAt: Date;
	updatedAt: Date;
}

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

function trimDescription(description?: string): string {
	return description?.trim() ?? '';
}

function toProjectListItem(row: ProjectRow, environmentCount: number, serviceCount: number): ProjectListItemView {
	return {
		id: row.id,
		teamId: row.teamId,
		name: row.name,
		description: row.description,
		environmentCount,
		serviceCount,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

function toEnvironmentView(row: EnvironmentRow & { serviceCount: number }): EnvironmentView {
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
export class ProjectsService {
	async listProjectsForTeam(actingUserId: string, teamId: string): Promise<ProjectListItemView[]> {
		await this.requireTeamMember(actingUserId, teamId);

		const rows = await db
			.select({
				id: projects.id,
				teamId: projects.teamId,
				name: projects.name,
				description: projects.description,
				createdAt: projects.createdAt,
				updatedAt: projects.updatedAt
			})
			.from(projects)
			.where(eq(projects.teamId, teamId))
			.orderBy(asc(projects.createdAt), asc(projects.id));

		const ids = rows.map(row => row.id);
		if (!ids.length) return [];

		const environmentCounts = new Map<string, number>();
		const serviceCounts = new Map<string, number>();

		const envRows = await db
			.select({ projectId: environments.projectId, value: count() })
			.from(environments)
			.where(inArray(environments.projectId, ids))
			.groupBy(environments.projectId);

		for (const row of envRows) {
			environmentCounts.set(row.projectId, Number(row.value));
		}

		const serviceRows = await db
			.select({ projectId: environments.projectId, value: count(services.id) })
			.from(environments)
			.leftJoin(services, eq(services.environmentId, environments.id))
			.where(inArray(environments.projectId, ids))
			.groupBy(environments.projectId);

		for (const row of serviceRows) {
			serviceCounts.set(row.projectId, Number(row.value));
		}

		return rows.map(row => toProjectListItem(row, environmentCounts.get(row.id) ?? 0, serviceCounts.get(row.id) ?? 0));
	}

	async getProjectDetail(actingUserId: string, projectId: string): Promise<ProjectDetailView> {
		const project = await this.loadProjectForUser(actingUserId, projectId);
		const envs = await this.listEnvironmentsForProject(project.id);
		const serviceCount = envs.reduce((sum, env) => sum + env.serviceCount, 0);

		return { ...toProjectListItem(project, envs.length, serviceCount), environments: envs };
	}

	async createProject(actingUserId: string, teamId: string, input: CreateProjectInput): Promise<ProjectDetailView> {
		await this.requireTeamMember(actingUserId, teamId);

		const name = input.name.trim();
		if (await this.projectNameTaken(teamId, name)) throw new ProjectNameTakenError();

		const projectId = await db.transaction(async tx => {
			const [project] = await tx
				.insert(projects)
				.values({ teamId, name, description: trimDescription(input.description) })
				.returning({ id: projects.id });

			if (!project) throw new Error('failed to create project');
			await tx.insert(environments).values({ projectId: project.id, name: 'production' });
			return project.id;
		});

		return this.getProjectDetail(actingUserId, projectId);
	}

	async updateProject(actingUserId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDetailView> {
		const project = await this.loadProjectForUser(actingUserId, projectId);
		const values: { name?: string; description?: string; updatedAt: Date } = { updatedAt: new Date() };

		if (input.name !== undefined) {
			const name = input.name.trim();
			if (name !== project.name && (await this.projectNameTaken(project.teamId, name, project.id))) throw new ProjectNameTakenError();
			values.name = name;
		}

		if (input.description !== undefined) {
			values.description = input.description.trim();
		}

		await db.update(projects).set(values).where(eq(projects.id, project.id));
		return this.getProjectDetail(actingUserId, project.id);
	}

	async updateProjectPrPreviews(actingUserId: string, projectId: string, input: UpdateProjectPrPreviewsInput): Promise<ProjectDetailView> {
		const updatedProjectId = await db.transaction(async tx => {
			const [project] = await tx
				.select({ id: projects.id, teamId: projects.teamId })
				.from(projects)
				.innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actingUserId)))
				.where(eq(projects.id, projectId))
				.limit(1);
			if (!project) throw new ProjectNotFoundError();

			const persistentEnvironments = await tx
				.select({ id: environments.id })
				.from(environments)
				.where(and(eq(environments.projectId, project.id), eq(environments.kind, 'persistent')))
				.for('update');

			const targetEnvironmentId = input.baseEnvironmentId;
			if (targetEnvironmentId !== null && !persistentEnvironments.some(env => env.id === targetEnvironmentId)) {
				throw new ProjectEnvironmentNotFoundError();
			}

			const now = new Date();
			const disableWhere =
				targetEnvironmentId === null
					? and(eq(environments.projectId, project.id), eq(environments.kind, 'persistent'), eq(environments.prPreviewsEnabled, true))
					: and(
							eq(environments.projectId, project.id),
							eq(environments.kind, 'persistent'),
							eq(environments.prPreviewsEnabled, true),
							ne(environments.id, targetEnvironmentId)
						);

			await tx.update(environments).set({ prPreviewsEnabled: false, updatedAt: now }).where(disableWhere);

			if (targetEnvironmentId !== null) {
				await tx
					.update(environments)
					.set({ prPreviewsEnabled: true, updatedAt: now })
					.where(and(eq(environments.id, targetEnvironmentId), eq(environments.prPreviewsEnabled, false)));
			}

			return project.id;
		});

		return this.getProjectDetail(actingUserId, updatedProjectId);
	}

	async deleteProject(actingUserId: string, projectId: string): Promise<void> {
		const project = await this.loadProjectForUser(actingUserId, projectId);
		await db.delete(projects).where(eq(projects.id, project.id));
	}

	private async requireTeamMember(actingUserId: string, teamId: string): Promise<void> {
		const [membership] = await db
			.select({ teamId: teamMembers.teamId })
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actingUserId)))
			.limit(1);

		if (!membership) throw new TeamNotFoundError();
	}

	private async loadProjectForUser(actingUserId: string, projectId: string): Promise<ProjectRow> {
		const [row] = await db
			.select({
				id: projects.id,
				teamId: projects.teamId,
				name: projects.name,
				description: projects.description,
				createdAt: projects.createdAt,
				updatedAt: projects.updatedAt
			})
			.from(projects)
			.innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actingUserId)))
			.where(eq(projects.id, projectId))
			.limit(1);

		if (!row) throw new ProjectNotFoundError();
		return row;
	}

	private async projectNameTaken(teamId: string, name: string, exceptProjectId?: string): Promise<boolean> {
		const [row] = await db
			.select({ id: projects.id })
			.from(projects)
			.where(
				exceptProjectId
					? and(eq(projects.teamId, teamId), eq(projects.name, name), ne(projects.id, exceptProjectId))
					: and(eq(projects.teamId, teamId), eq(projects.name, name))
			)
			.limit(1);

		return Boolean(row);
	}

	private async listEnvironmentsForProject(projectId: string): Promise<EnvironmentView[]> {
		const rows = await db
			.select({
				id: environments.id,
				projectId: environments.projectId,
				name: environments.name,
				kind: environments.kind,
				prPreviewsEnabled: environments.prPreviewsEnabled,
				prNumber: environments.prNumber,
				prRepoUrl: environments.prRepoUrl,
				baseEnvironmentId: environments.baseEnvironmentId,
				createdAt: environments.createdAt,
				updatedAt: environments.updatedAt,
				serviceCount: count(services.id)
			})
			.from(environments)
			.leftJoin(services, eq(services.environmentId, environments.id))
			.where(eq(environments.projectId, projectId))
			.groupBy(
				environments.id,
				environments.projectId,
				environments.name,
				environments.kind,
				environments.prPreviewsEnabled,
				environments.prNumber,
				environments.prRepoUrl,
				environments.baseEnvironmentId,
				environments.createdAt,
				environments.updatedAt
			)
			.orderBy(asc(environments.createdAt), asc(environments.id));

		return rows.map(row => toEnvironmentView(row));
	}
}
