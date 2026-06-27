import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import {
	CreateProjectDto,
	ProjectDetailDto,
	ProjectListItemDto,
	ProjectOkDto,
	UpdateProjectDto,
	UpdateProjectPrPreviewsDto,
	createProjectSchema,
	projectIdParamSchema,
	teamProjectParamSchema,
	updateProjectPrPreviewsSchema,
	updateProjectSchema,
	type CreateProjectInput,
	type ProjectIdParam,
	type TeamProjectParam,
	type UpdateProjectInput,
	type UpdateProjectPrPreviewsInput
} from './projects.dto.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller()
export class ProjectsController {
	constructor(private readonly projects: ProjectsService) {}

	@Get('teams/:teamId/projects')
	@ApiOperation({ operationId: 'teamProjectsList', summary: 'List projects for a team' })
	@ApiOkResponse({ type: [ProjectListItemDto] })
	listTeamProjects(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(teamProjectParamSchema)) params: TeamProjectParam
	): Promise<ProjectListItemDto[]> {
		return this.projects.listProjectsForTeam(userId, params.teamId);
	}

	@Post('teams/:teamId/projects')
	@HttpCode(201)
	@ApiOperation({ operationId: 'teamProjectsCreate', summary: 'Create a project in a team' })
	@ApiBody({ type: CreateProjectDto })
	@ApiCreatedResponse({ type: ProjectDetailDto })
	createTeamProject(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(teamProjectParamSchema)) params: TeamProjectParam,
		@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput
	): Promise<ProjectDetailDto> {
		return this.projects.createProject(userId, params.teamId, body);
	}

	@Get('projects/:projectId')
	@ApiOperation({ operationId: 'projectsGet', summary: 'Get project details' })
	@ApiOkResponse({ type: ProjectDetailDto })
	getProject(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(projectIdParamSchema)) params: ProjectIdParam): Promise<ProjectDetailDto> {
		return this.projects.getProjectDetail(userId, params.projectId);
	}

	@Patch('projects/:projectId')
	@ApiOperation({ operationId: 'projectsUpdate', summary: 'Update a project' })
	@ApiBody({ type: UpdateProjectDto })
	@ApiOkResponse({ type: ProjectDetailDto })
	updateProject(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(projectIdParamSchema)) params: ProjectIdParam,
		@Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput
	): Promise<ProjectDetailDto> {
		return this.projects.updateProject(userId, params.projectId, body);
	}

	@Patch('projects/:projectId/pr-previews')
	@ApiOperation({ operationId: 'projectsSetPrPreviews', summary: 'Update PR preview base environment' })
	@ApiBody({ type: UpdateProjectPrPreviewsDto })
	@ApiOkResponse({ type: ProjectDetailDto })
	updateProjectPrPreviews(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(projectIdParamSchema)) params: ProjectIdParam,
		@Body(new ZodValidationPipe(updateProjectPrPreviewsSchema)) body: UpdateProjectPrPreviewsInput
	): Promise<ProjectDetailDto> {
		return this.projects.updateProjectPrPreviews(userId, params.projectId, body);
	}

	@Delete('projects/:projectId')
	@ApiOperation({ operationId: 'projectsDelete', summary: 'Delete a project' })
	@ApiOkResponse({ type: ProjectOkDto })
	async deleteProject(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(projectIdParamSchema)) params: ProjectIdParam
	): Promise<ProjectOkDto> {
		await this.projects.deleteProject(userId, params.projectId);
		return { ok: true };
	}
}
