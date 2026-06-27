import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../shared/auth/auth.guard.js';
import { PlatformVersionCheckResultDto, PlatformVersionInfoDto } from './version/platform-version.dto.js';
import { PlatformVersionService } from './version/platform-version.service.js';

@ApiTags('platform')
@Controller('platform')
export class PlatformController {
	constructor(private readonly version: PlatformVersionService) {}

	@Get('version')
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'platformVersionGet', summary: 'Get platform version metadata' })
	@ApiOkResponse({ type: PlatformVersionInfoDto })
	getVersion(): Promise<PlatformVersionInfoDto> {
		return this.version.getVersionInfo();
	}

	@Post('version/check')
	@HttpCode(200)
	@UseGuards(AdminGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'platformVersionCheck', summary: 'Check for platform updates' })
	@ApiOkResponse({ type: PlatformVersionCheckResultDto })
	checkVersion(): Promise<PlatformVersionCheckResultDto> {
		return this.version.checkForUpdates();
	}
}
