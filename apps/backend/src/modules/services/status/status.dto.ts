import { ApiProperty } from '@nestjs/swagger';
import type { ServiceRuntime, ServiceRuntimeStatus } from '@kubwave/kube';

export class ServiceRuntimeDto implements ServiceRuntime {
	@ApiProperty({ enum: ['running', 'degraded', 'progressing', 'stopped', 'failed', 'not_deployed', 'unknown'] })
	status!: ServiceRuntimeStatus;

	@ApiProperty({ type: Number })
	readyReplicas!: number;

	@ApiProperty({ type: Number })
	desiredReplicas!: number;

	@ApiProperty({ type: Number })
	updatedReplicas!: number;

	@ApiProperty({ type: Number })
	availableReplicas!: number;
}

export class ServiceRuntimeEntryDto {
	@ApiProperty({ type: String, format: 'uuid' })
	serviceId!: string;

	@ApiProperty({ type: ServiceRuntimeDto })
	runtime!: ServiceRuntimeDto;
}
