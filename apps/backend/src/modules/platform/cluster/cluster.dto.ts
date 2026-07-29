import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { MetricPointDto } from '../../../shared/metrics/metric-point.dto.js';
import { metricsRangeSchema, type MetricsRange } from '../../../shared/metrics/prometheus.types.js';

export const clusterUsageQuerySchema = z.object({ range: metricsRangeSchema.optional() });

export type ClusterUsageQuery = z.infer<typeof clusterUsageQuerySchema>;

export class ClusterMeterDto {
	@ApiProperty({ type: Number })
	capacity!: number;

	// null where a reservation has no meaning: node filesystems, PVCs, and pod counts are not scheduled against requests.
	@ApiProperty({ type: Number, nullable: true })
	requested!: number | null;

	// null when the kubelet reported no usage for this scope, so the console shows "unknown" rather than zero.
	@ApiProperty({ type: Number, nullable: true })
	used!: number | null;
}

export class ClusterNodeConditionsDto {
	@ApiProperty({ type: Boolean })
	ready!: boolean;

	@ApiProperty({ type: Boolean })
	memoryPressure!: boolean;

	@ApiProperty({ type: Boolean })
	diskPressure!: boolean;

	@ApiProperty({ type: Boolean })
	pidPressure!: boolean;
}

export class ClusterNodeDto {
	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: [String] })
	roles!: string[];

	@ApiProperty({ type: Boolean })
	cordoned!: boolean;

	@ApiProperty({ type: String })
	kubeletVersion!: string;

	@ApiProperty({ type: ClusterNodeConditionsDto })
	conditions!: ClusterNodeConditionsDto;

	@ApiProperty({ type: ClusterMeterDto })
	cpu!: ClusterMeterDto;

	@ApiProperty({ type: ClusterMeterDto })
	memory!: ClusterMeterDto;

	@ApiProperty({ type: ClusterMeterDto })
	disk!: ClusterMeterDto;

	@ApiProperty({ type: ClusterMeterDto })
	pods!: ClusterMeterDto;
}

export class ClusterComponentDto {
	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: Number })
	ready!: number;

	@ApiProperty({ type: Number })
	desired!: number;
}

export class ClusterWorkloadUsageDto {
	@ApiProperty({ type: Number })
	cpuMillicores!: number;

	@ApiProperty({ type: Number })
	memoryBytes!: number;
}

export class ClusterSplitDto {
	@ApiProperty({ type: ClusterWorkloadUsageDto })
	platform!: ClusterWorkloadUsageDto;

	@ApiProperty({ type: ClusterWorkloadUsageDto })
	tenants!: ClusterWorkloadUsageDto;

	@ApiProperty({ type: ClusterWorkloadUsageDto })
	other!: ClusterWorkloadUsageDto;
}

export class ClusterSnapshotDto {
	@ApiProperty({ type: Boolean })
	available!: boolean;

	@ApiProperty({ type: String })
	sampledAt!: string;

	@ApiProperty({ enum: ['ok', 'degraded', 'unknown'] })
	state!: 'ok' | 'degraded' | 'unknown';

	@ApiProperty({ type: Number })
	nodesReady!: number;

	@ApiProperty({ type: Number })
	nodesTotal!: number;

	@ApiProperty({ type: ClusterMeterDto })
	cpu!: ClusterMeterDto;

	@ApiProperty({ type: ClusterMeterDto })
	memory!: ClusterMeterDto;

	@ApiProperty({ type: ClusterMeterDto })
	storage!: ClusterMeterDto;

	@ApiProperty({ type: ClusterMeterDto })
	pods!: ClusterMeterDto;

	@ApiProperty({ type: [ClusterNodeDto] })
	nodes!: ClusterNodeDto[];

	@ApiProperty({ type: [ClusterComponentDto] })
	components!: ClusterComponentDto[];

	@ApiProperty({ type: ClusterSplitDto })
	split!: ClusterSplitDto;
}

export class ClusterEventDto {
	@ApiProperty({ type: String })
	id!: string;

	@ApiProperty({ type: String })
	reason!: string;

	@ApiProperty({ type: String })
	message!: string;

	@ApiProperty({ type: String, nullable: true })
	namespace!: string | null;

	@ApiProperty({ type: String, nullable: true })
	objectKind!: string | null;

	@ApiProperty({ type: String, nullable: true })
	objectName!: string | null;

	@ApiProperty({ type: Number })
	count!: number;

	@ApiProperty({ type: String, nullable: true })
	lastSeen!: string | null;
}

export class ClusterEventsDto {
	@ApiProperty({ type: Boolean })
	available!: boolean;

	@ApiProperty({ type: String })
	sampledAt!: string;

	@ApiProperty({ type: [ClusterEventDto] })
	events!: ClusterEventDto[];
}

export class ClusterUsageSeriesDto {
	@ApiProperty({ type: [MetricPointDto] })
	cpuMillicores!: MetricPointDto[];

	@ApiProperty({ type: [MetricPointDto] })
	memoryBytes!: MetricPointDto[];
}

export class ClusterUsageDto {
	@ApiProperty({ type: Boolean })
	available!: boolean;

	@ApiProperty({ enum: ['1h', '24h', '7d'] })
	range!: MetricsRange;

	@ApiProperty({ type: String })
	sampledAt!: string;

	@ApiProperty({ type: ClusterUsageSeriesDto })
	series!: ClusterUsageSeriesDto;
}
