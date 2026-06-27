import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { SessionUserDto } from '../auth/auth.dto.js';

export const inviteIdParamSchema = z.object({ id: z.string().uuid() });
export const inviteTokenParamSchema = z.object({ id: z.string().min(1) });

export const createInviteSchema = z.object({
	email: z.string().email(),
	isAdmin: z.boolean().default(false)
});

export const acceptInviteSchema = z.object({
	name: z.string().min(1),
	password: z.string().min(8)
});

export type InviteIdParam = z.infer<typeof inviteIdParamSchema>;
export type InviteTokenParam = z.infer<typeof inviteTokenParamSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export class CreateInviteDto implements CreateInviteInput {
	@ApiProperty({ type: String, format: 'email' })
	email!: string;

	@ApiProperty({ type: Boolean, default: false })
	isAdmin!: boolean;
}

export class AcceptInviteDto implements AcceptInviteInput {
	@ApiProperty({ type: String, minLength: 1 })
	name!: string;

	@ApiProperty({ type: String, minLength: 8 })
	password!: string;
}

export class InvitationDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String, format: 'email' })
	email!: string;

	@ApiProperty({ type: Boolean })
	isAdmin!: boolean;

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	invitedBy!: string | null;

	@ApiProperty({ type: String })
	expiresAt!: string;

	@ApiProperty({ type: String, nullable: true })
	acceptedAt!: string | null;

	@ApiProperty({ type: String })
	createdAt!: string;

	@ApiProperty({ enum: ['pending', 'accepted', 'expired'] })
	status!: InvitationStatus;
}

export class CreateInviteResultDto {
	@ApiProperty({ type: InvitationDto })
	invitation!: InvitationDto;

	@ApiProperty({ type: Boolean })
	emailSent!: boolean;

	@ApiPropertyOptional({ type: String })
	emailError?: string;
}

export class InviteValidityDto {
	@ApiProperty({ type: Boolean })
	valid!: boolean;

	@ApiPropertyOptional({ type: String, format: 'email' })
	email?: string;
}

export class AcceptInviteResponseDto {
	@ApiProperty({ type: String })
	accessToken!: string;

	@ApiProperty({ type: SessionUserDto })
	user!: SessionUserDto;
}

export class InviteOkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}
