import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { ClusterEventsDto, ClusterSnapshotDto, ClusterUsageDto, clusterUsageQuerySchema, type ClusterUsageQuery } from './cluster.dto.js';
import { ClusterEventsService } from './cluster-events.service.js';
import { ClusterSnapshotService } from './cluster-snapshot.service.js';
import { ClusterUsageService } from './cluster-usage.service.js';

@ApiTags('platform')
@Controller('platform/cluster')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class ClusterController {
	constructor(
		private readonly snapshot: ClusterSnapshotService,
		private readonly events: ClusterEventsService,
		private readonly usage: ClusterUsageService
	) {}

	@Get()
	@ApiOperation({ operationId: 'platformClusterGet', summary: 'Get a cluster capacity and health snapshot' })
	@ApiOkResponse({ type: ClusterSnapshotDto })
	getSnapshot(): Promise<ClusterSnapshotDto> {
		return this.snapshot.getSnapshot();
	}

	@Get('events')
	@ApiOperation({ operationId: 'platformClusterEventsGet', summary: 'List cluster-wide Kubernetes warning events' })
	@ApiOkResponse({ type: ClusterEventsDto })
	getEvents(): Promise<ClusterEventsDto> {
		return this.events.getEvents();
	}

	@Get('usage')
	@ApiOperation({ operationId: 'platformClusterUsageGet', summary: 'Get cluster-wide CPU and memory history' })
	@ApiQuery({ name: 'range', enum: ['1h', '24h', '7d'], required: false })
	@ApiOkResponse({ type: ClusterUsageDto })
	getUsage(@Query(new ZodValidationPipe(clusterUsageQuerySchema)) query: ClusterUsageQuery): Promise<ClusterUsageDto> {
		return this.usage.getUsage(query.range);
	}
}
