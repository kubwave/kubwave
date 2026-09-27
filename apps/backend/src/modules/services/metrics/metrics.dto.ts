import { ApiProperty } from '@nestjs/swagger';
import { MetricPointDto } from '../../../shared/metrics/metric-point.dto.js';

export class ServiceMetricVolumeDto {
	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: Number })
	usedBytes!: number;

	@ApiProperty({ type: Number })
	capacityBytes!: number;
}

export class ServiceMetricVolumeSeriesDto {
	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: [MetricPointDto] })
	points!: MetricPointDto[];
}

export class ServiceMetricsCurrentDto {
	@ApiProperty({ type: Number })
	cpuMillicores!: number;

	@ApiProperty({ type: Number })
	memoryBytes!: number;

	@ApiProperty({ type: Number })
	networkRxBytes!: number;

	@ApiProperty({ type: Number })
	networkTxBytes!: number;

	@ApiProperty({ type: [ServiceMetricVolumeDto] })
	volumes!: ServiceMetricVolumeDto[];
}

export class ServiceMetricsLimitsDto {
	@ApiProperty({ type: Number, nullable: true })
	cpuMillicores!: number | null;

	@ApiProperty({ type: Number, nullable: true })
	memoryBytes!: number | null;
}

export class ServiceMetricsSeriesDto {
	@ApiProperty({ type: [MetricPointDto] })
	cpuMillicores!: MetricPointDto[];

	@ApiProperty({ type: [MetricPointDto] })
	memoryBytes!: MetricPointDto[];

	@ApiProperty({ type: [MetricPointDto] })
	networkRxBytes!: MetricPointDto[];

	@ApiProperty({ type: [MetricPointDto] })
	networkTxBytes!: MetricPointDto[];

	@ApiProperty({ type: [ServiceMetricVolumeSeriesDto] })
	volumes!: ServiceMetricVolumeSeriesDto[];
}

export class ServiceMetricsDto {
	@ApiProperty({ enum: ['live', 'historical'] })
	mode!: 'live' | 'historical';

	@ApiProperty({ type: Boolean })
	available!: boolean;

	@ApiProperty({ type: String })
	sampledAt!: string;

	@ApiProperty({ type: Number })
	replicas!: number;

	@ApiProperty({ type: ServiceMetricsCurrentDto })
	current!: ServiceMetricsCurrentDto;

	@ApiProperty({ type: ServiceMetricsLimitsDto })
	limits!: ServiceMetricsLimitsDto;

	@ApiProperty({ type: ServiceMetricsSeriesDto })
	series!: ServiceMetricsSeriesDto;
}
