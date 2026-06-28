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

export const forgotPasswordSchema = z.object({
	email: z.string().email()
});

export const resetPasswordSchema = z.object({
	token: z.string().min(1),
	password: z.string().min(8).max(200)
});

export const resetTokenParamSchema = z.object({ token: z.string().min(1) });

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ResetTokenParam = z.infer<typeof resetTokenParamSchema>;

export class ForgotPasswordRequestDto implements ForgotPasswordInput {
	@ApiProperty({ type: String, format: 'email' })
	email!: string;
}

export class ResetPasswordRequestDto implements ResetPasswordInput {
	@ApiProperty({ type: String, minLength: 1 })
	token!: string;

	@ApiProperty({ type: String, minLength: 8, maxLength: 200 })
	password!: string;
}

export class AuthOkDto {
	@ApiProperty({ type: Boolean })
	ok!: true;
}

export class ResetTokenValidityDto {
	@ApiProperty({ type: Boolean })
	valid!: boolean;
}
