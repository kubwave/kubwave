import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import {
	PlatformOkDto,
	PlatformUserDto,
	UpdatePlatformUserDto,
	platformUserIdParamSchema,
	updatePlatformUserSchema,
	type PlatformUserIdParam,
	type UpdatePlatformUserInput
} from './platform-users.dto.js';
import { PlatformUsersService } from './platform-users.service.js';

@ApiTags('platform-users')
@Controller('platform/users')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformUsersController {
	constructor(private readonly users: PlatformUsersService) {}

	@Get()
	@ApiOperation({ operationId: 'platformUsersList', summary: 'List platform users' })
	@ApiOkResponse({ type: [PlatformUserDto] })
	listUsers(): Promise<PlatformUserDto[]> {
		return this.users.listUsers();
	}

	@Patch(':id')
	@ApiOperation({ operationId: 'platformUsersUpdate', summary: 'Update a platform user' })
	@ApiBody({ type: UpdatePlatformUserDto })
	@ApiOkResponse({ type: PlatformUserDto })
	updateUser(
		@Param(new ZodValidationPipe(platformUserIdParamSchema)) params: PlatformUserIdParam,
		@Body(new ZodValidationPipe(updatePlatformUserSchema)) body: UpdatePlatformUserInput,
		@CurrentUserId() actingUserId: string
	): Promise<PlatformUserDto> {
		return this.users.updateUser(params.id, body, actingUserId);
	}

	@Delete(':id')
	@ApiOperation({ operationId: 'platformUsersDelete', summary: 'Delete a platform user' })
	@ApiOkResponse({ type: PlatformOkDto })
	async deleteUser(
		@Param(new ZodValidationPipe(platformUserIdParamSchema)) params: PlatformUserIdParam,
		@CurrentUserId() actingUserId: string
	): Promise<PlatformOkDto> {
		await this.users.deleteUser(params.id, actingUserId);
		return { ok: true };
	}
}
