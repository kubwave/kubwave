import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../../../shared/auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	TcpPortPoolSettingsDto,
	TcpPortPoolSettingsUpdateDto,
	tcpPortPoolSettingsSchema,
	type TcpPortPoolSettingsInput
} from './platform-tcp-port-pool-settings.dto.js';
import { PlatformTcpPortPoolSettingsService } from './platform-tcp-port-pool-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/tcp-port-pool')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformTcpPortPoolSettingsController {
	constructor(private readonly tcpPortPoolSettings: PlatformTcpPortPoolSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsTcpPortPoolGet', summary: 'Get public TCP port pool settings' })
	@ApiOkResponse({ type: TcpPortPoolSettingsDto })
	getSettings(): Promise<TcpPortPoolSettingsDto> {
		return this.tcpPortPoolSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsTcpPortPoolUpdate', summary: 'Update public TCP port pool settings' })
	@ApiBody({ type: TcpPortPoolSettingsDto })
	@ApiOkResponse({ type: TcpPortPoolSettingsUpdateDto })
	updateSettings(
		@Body(new ZodValidationPipe(tcpPortPoolSettingsSchema)) body: TcpPortPoolSettingsInput,
		@CurrentUserId() userId: string
	): Promise<TcpPortPoolSettingsUpdateDto> {
		return this.tcpPortPoolSettings.updateSettings(body, userId);
	}
}
