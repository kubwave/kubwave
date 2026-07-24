import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { TCP_PORT_POOL_MAX_SIZE, TCP_PORT_POOL_MIN_PORT } from '@kubwave/kube';
import { UpdateRunDto } from '../../updates/platform-updates.dto.js';

export const tcpPortPoolSettingsSchema = z
	.object({
		enabled: z.boolean(),
		start: z.number().int().min(TCP_PORT_POOL_MIN_PORT).max(65535),
		size: z.number().int().min(1).max(TCP_PORT_POOL_MAX_SIZE)
	})
	.refine(value => value.start + value.size - 1 <= 65535, { message: 'TCP port pool must end at or below 65535.', path: ['size'] });

export type TcpPortPoolSettingsInput = z.infer<typeof tcpPortPoolSettingsSchema>;

export class TcpPortPoolSettingsDto implements TcpPortPoolSettingsInput {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;

	@ApiProperty({ type: Number, minimum: TCP_PORT_POOL_MIN_PORT, maximum: 65535 })
	start!: number;

	@ApiProperty({ type: Number, minimum: 1, maximum: TCP_PORT_POOL_MAX_SIZE })
	size!: number;
}

export class TcpPortPoolSettingsUpdateDto extends TcpPortPoolSettingsDto {
	@ApiProperty({ type: UpdateRunDto })
	updateRun!: UpdateRunDto;
}
