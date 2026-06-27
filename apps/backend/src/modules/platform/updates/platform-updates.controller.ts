import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import {
	TriggerUpdateDto,
	UpdateLogsDto,
	UpdateRunDto,
	triggerUpdateSchema,
	updateRunIdParamSchema,
	type TriggerUpdateInput,
	type UpdateRunIdParam
} from './platform-updates.dto.js';
import { PlatformUpdatesService } from './platform-updates.service.js';

@ApiTags('platform-updates')
@Controller('platform/updates')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformUpdatesController {
	constructor(private readonly updates: PlatformUpdatesService) {}

	@Get()
	@ApiOperation({ operationId: 'platformUpdatesList', summary: 'List platform update runs' })
	@ApiOkResponse({ type: [UpdateRunDto] })
	listUpdateRuns(): Promise<UpdateRunDto[]> {
		return this.updates.listUpdateRuns();
	}

	@Post()
	@HttpCode(200)
	@ApiOperation({ operationId: 'platformUpdatesTrigger', summary: 'Trigger a platform update' })
	@ApiBody({ type: TriggerUpdateDto })
	@ApiOkResponse({ type: UpdateRunDto })
	triggerUpdate(@Body(new ZodValidationPipe(triggerUpdateSchema)) body: TriggerUpdateInput, @CurrentUserId() userId: string): Promise<UpdateRunDto> {
		return this.updates.triggerUpdate(body.targetVersion, userId);
	}

	@Get(':id')
	@ApiOperation({ operationId: 'platformUpdatesGet', summary: 'Get a platform update run' })
	@ApiOkResponse({ type: UpdateRunDto })
	getUpdateRun(@Param(new ZodValidationPipe(updateRunIdParamSchema)) params: UpdateRunIdParam): Promise<UpdateRunDto> {
		return this.updates.getUpdateRun(params.id);
	}

	@Get(':id/logs')
	@ApiOperation({ operationId: 'platformUpdateLogsGet', summary: 'Get platform update job logs' })
	@ApiOkResponse({ type: UpdateLogsDto })
	async getUpdateLogs(@Param(new ZodValidationPipe(updateRunIdParamSchema)) params: UpdateRunIdParam): Promise<UpdateLogsDto> {
		return { logs: await this.updates.getJobLogs(params.id) };
	}
}
