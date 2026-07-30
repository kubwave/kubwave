import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import {
	ClusterEventsDto,
	ClusterNodeDetailDto,
	ClusterNodeUsageDto,
	ClusterSnapshotDto,
	ClusterUsageDto,
	clusterNodeParamsSchema,
	clusterUsageQuerySchema,
	type ClusterNodeParams,
	type ClusterUsageQuery
} from './cluster.dto.js';
import { ClusterEventsService } from './cluster-events.service.js';
import { ClusterNodeUsageService } from './cluster-node-usage.service.js';
import { ClusterNodeService } from './cluster-node.service.js';
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
		private readonly usage: ClusterUsageService,
		private readonly node: ClusterNodeService,
		private readonly nodeUsage: ClusterNodeUsageService
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

	@Get('nodes/:name')
	@ApiOperation({ operationId: 'platformClusterNodeGet', summary: 'Get one node with its pods, conditions and events' })
	@ApiOkResponse({ type: ClusterNodeDetailDto })
	getNode(@Param(new ZodValidationPipe(clusterNodeParamsSchema)) params: ClusterNodeParams): Promise<ClusterNodeDetailDto> {
		return this.node.getNode(params.name);
	}

	@Get('nodes/:name/usage')
	@ApiOperation({ operationId: 'platformClusterNodeUsageGet', summary: 'Get one node CPU, memory and disk history' })
	@ApiQuery({ name: 'range', enum: ['1h', '24h', '7d'], required: false })
	@ApiOkResponse({ type: ClusterNodeUsageDto })
	getNodeUsage(
		@Param(new ZodValidationPipe(clusterNodeParamsSchema)) params: ClusterNodeParams,
		@Query(new ZodValidationPipe(clusterUsageQuerySchema)) query: ClusterUsageQuery
	): Promise<ClusterNodeUsageDto> {
		return this.nodeUsage.getUsage(params.name, query.range);
	}
}
