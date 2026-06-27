import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const serviceLogsQuerySchema = z.object({
	pod: z.string().optional(),
	tailLines: z.coerce.number().int().min(1).max(2000).optional()
});

export type ServiceLogsQuery = z.infer<typeof serviceLogsQuerySchema>;

export interface ServiceLogsOptions {
	pod?: string;
	tailLines?: number;
}

export class ServiceLogEntryDto {
	@ApiProperty({ type: String })
	pod!: string;

	@ApiProperty({ type: String, nullable: true })
	timestamp!: string | null;

	@ApiProperty({ type: String })
	message!: string;
}

export class ServiceLogsDto {
	@ApiProperty({ type: Boolean })
	available!: boolean;

	@ApiProperty({ type: [String] })
	pods!: string[];

	@ApiProperty({ type: [ServiceLogEntryDto] })
	entries!: ServiceLogEntryDto[];
}
