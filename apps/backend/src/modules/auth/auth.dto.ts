import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1)
});

export type LoginInput = z.infer<typeof loginSchema>;

export class LoginRequestDto implements LoginInput {
	@ApiProperty({ type: String, format: 'email' })
	email!: string;

	@ApiProperty({ type: String, minLength: 1 })
	password!: string;
}

export class SessionUserDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id!: string;

	@ApiProperty({ type: String })
	name!: string;

	@ApiProperty({ type: String, format: 'email' })
	email!: string;

	@ApiProperty({ type: Boolean })
	isAdmin!: boolean;
}

export class LoginResponseDto {
	@ApiProperty({ type: String })
	accessToken!: string;

	@ApiProperty({ type: SessionUserDto })
	user!: SessionUserDto;
}

export class RefreshResponseDto {
	@ApiProperty({ type: String })
	accessToken!: string;
}

export class SessionResponseDto {
	@ApiProperty({ type: SessionUserDto })
	user!: SessionUserDto;
}
