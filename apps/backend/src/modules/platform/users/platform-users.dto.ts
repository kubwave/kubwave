import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const platformUserIdParamSchema = z.object({ id: z.string().uuid() });

export const updatePlatformUserSchema = z.object({
	name: z.string().trim().min(1).optional(),
	isAdmin: z.boolean().optional()
});

export type PlatformUserIdParam = z.infer<typeof platformUserIdParamSchema>;
export type UpdatePlatformUserInput = z.infer<typeof updatePlatformUserSchema>;

export class PlatformUserDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: String, format: 'email' })
	email!: string;

	@ApiProperty({ type: Boolean })
	isAdmin!: boolean;

	@ApiProperty({ type: String })
	createdAt!: string;

	@ApiProperty({ type: String })
	updatedAt!: string;
}

export class UpdatePlatformUserDto implements UpdatePlatformUserInput {
	@ApiProperty({ type: String, minLength: 1, required: false })
	name?: string;

	@ApiProperty({ type: Boolean, required: false })
	isAdmin?: boolean;
}

export class PlatformOkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}
