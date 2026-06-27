import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { PlatformVolumesDto } from './platform-volumes.dto.js';
import { PlatformVolumesService } from './platform-volumes.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/platform-volumes')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformVolumesController {
	constructor(private readonly platformVolumes: PlatformVolumesService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsPlatformVolumesGet', summary: 'Get platform volume usage' })
	@ApiOkResponse({ type: PlatformVolumesDto })
	getPlatformVolumes(): Promise<PlatformVolumesDto> {
		return this.platformVolumes.getPlatformVolumes();
	}
}
