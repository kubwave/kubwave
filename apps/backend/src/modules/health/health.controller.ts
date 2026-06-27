import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';

class HealthResponseDto {
	@ApiProperty({ enum: ['ok'] })
	status!: 'ok';

	@ApiProperty({ type: Number })
	uptime!: number;

	@ApiProperty({ type: String })
	timestamp!: string;

	@ApiPropertyOptional({ type: String })
	node?: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
	@Get()
	@ApiOperation({ operationId: 'healthGet', summary: 'Health check' })
	@ApiQuery({ name: 'verbose', enum: ['true', 'false'], required: false })
	@ApiOkResponse({ type: HealthResponseDto, description: 'Service health and uptime.' })
	getHealth(): HealthResponseDto {
		return {
			status: 'ok',
			uptime: Math.round(process.uptime()),
			timestamp: new Date().toISOString(),
			node: process.version
		};
	}
}
