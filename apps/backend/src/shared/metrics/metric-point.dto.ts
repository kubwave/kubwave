import { ApiProperty } from '@nestjs/swagger';

export class MetricPointDto {
	@ApiProperty({ type: Number })
	t!: number;

	@ApiProperty({ type: Number })
	v!: number;
}
