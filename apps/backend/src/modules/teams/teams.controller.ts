import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { CookieService } from '../../shared/cookies/cookie.service.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import {
	ActiveTeamResponseDto,
	AddMemberDto,
	CreateTeamDto,
	OkDto,
	RenameTeamDto,
	SetActiveTeamDto,
	TeamDto,
	TeamMemberDto,
	TeamStateDto,
	UpdateMemberRoleDto,
	addMemberSchema,
	createTeamSchema,
	renameTeamSchema,
	setActiveTeamSchema,
	teamIdParamSchema,
	teamMemberParamSchema,
	updateMemberRoleSchema,
	type AddMemberInput,
	type CreateTeamInput,
	type RenameTeamInput,
	type SetActiveTeamInput,
	type TeamIdParam,
	type TeamMemberParam,
	type UpdateMemberRoleInput
} from './teams.dto.js';
import { TeamsService } from './teams.service.js';

@ApiTags('teams')
@ApiBearerAuth('bearerAuth')
@UseGuards(AuthGuard)
@Controller('teams')
export class TeamsController {
	constructor(
		private readonly cookies: CookieService,
		private readonly teams: TeamsService
	) {}

	@Get()
	@ApiOperation({ operationId: 'teamsList', summary: 'List teams and resolve active team' })
	@ApiOkResponse({ type: TeamStateDto })
	async listTeams(
		@CurrentUserId() userId: string,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply
	): Promise<TeamStateDto> {
		const state = await this.teams.getTeamState(userId, this.cookies.getActiveTeam(request));
		if (state.activeTeamId) {
			this.cookies.setActiveTeam(reply, state.activeTeamId);
		} else {
			this.cookies.clearActiveTeam(reply);
		}
		return state;
	}

	@Post()
	@HttpCode(201)
	@ApiOperation({ operationId: 'teamsCreate', summary: 'Create a team' })
	@ApiBody({ type: CreateTeamDto })
	@ApiCreatedResponse({ type: TeamDto })
	createTeam(@CurrentUserId() userId: string, @Body(new ZodValidationPipe(createTeamSchema)) body: CreateTeamInput): Promise<TeamDto> {
		return this.teams.createTeam(userId, body.name);
	}

	@Put('active')
	@ApiOperation({ operationId: 'teamsSetActive', summary: 'Set active team' })
	@ApiBody({ type: SetActiveTeamDto })
	@ApiOkResponse({ type: ActiveTeamResponseDto })
	async setActiveTeam(
		@CurrentUserId() userId: string,
		@Body(new ZodValidationPipe(setActiveTeamSchema)) body: SetActiveTeamInput,
		@Res({ passthrough: true }) reply: FastifyReply
	): Promise<ActiveTeamResponseDto> {
		const team = await this.teams.setActiveTeamForUser(userId, body.teamId);
		this.cookies.setActiveTeam(reply, team.id);
		return { activeTeamId: team.id, team };
	}

	@Patch(':teamId')
	@ApiOperation({ operationId: 'teamsRename', summary: 'Rename a team' })
	@ApiBody({ type: RenameTeamDto })
	@ApiOkResponse({ type: TeamDto })
	renameTeam(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(teamIdParamSchema)) params: TeamIdParam,
		@Body(new ZodValidationPipe(renameTeamSchema)) body: RenameTeamInput
	): Promise<TeamDto> {
		return this.teams.renameTeam(userId, params.teamId, body.name);
	}

	@Delete(':teamId')
	@ApiOperation({ operationId: 'teamsDelete', summary: 'Delete a team' })
	@ApiOkResponse({ type: OkDto })
	async deleteTeam(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(teamIdParamSchema)) params: TeamIdParam): Promise<OkDto> {
		await this.teams.deleteTeam(userId, params.teamId);
		return { ok: true };
	}

	@Get(':teamId/members')
	@ApiOperation({ operationId: 'teamMembersList', summary: 'List team members' })
	@ApiOkResponse({ type: [TeamMemberDto] })
	listMembers(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(teamIdParamSchema)) params: TeamIdParam): Promise<TeamMemberDto[]> {
		return this.teams.listTeamMembers(userId, params.teamId);
	}

	@Post(':teamId/members')
	@HttpCode(201)
	@ApiOperation({ operationId: 'teamMembersAdd', summary: 'Add a team member' })
	@ApiBody({ type: AddMemberDto })
	@ApiCreatedResponse({ type: TeamMemberDto })
	addMember(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(teamIdParamSchema)) params: TeamIdParam,
		@Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberInput
	): Promise<TeamMemberDto> {
		return this.teams.addTeamMember(userId, params.teamId, body.email);
	}

	@Patch(':teamId/members/:userId')
	@ApiOperation({ operationId: 'teamMembersUpdateRole', summary: 'Update team member role' })
	@ApiBody({ type: UpdateMemberRoleDto })
	@ApiOkResponse({ type: TeamMemberDto })
	updateMemberRole(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(teamMemberParamSchema)) params: TeamMemberParam,
		@Body(new ZodValidationPipe(updateMemberRoleSchema)) body: UpdateMemberRoleInput
	): Promise<TeamMemberDto> {
		return this.teams.updateTeamMemberRole(userId, params.teamId, params.userId, body.role);
	}

	@Delete(':teamId/members/:userId')
	@ApiOperation({ operationId: 'teamMembersRemove', summary: 'Remove a team member' })
	@ApiOkResponse({ type: OkDto })
	async removeMember(@CurrentUserId() userId: string, @Param(new ZodValidationPipe(teamMemberParamSchema)) params: TeamMemberParam): Promise<OkDto> {
		await this.teams.removeTeamMember(userId, params.teamId, params.userId);
		return { ok: true };
	}
}
