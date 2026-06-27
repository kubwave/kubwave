import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updateSmtpSettingsSchema = z
	.object({
		enabled: z.boolean(),
		host: z.string().nullable().optional(),
		port: z.number().int().min(1).max(65_535),
		secure: z.boolean(),
		user: z.string().nullable().optional(),
		password: z.string().nullable().optional(),
		fromName: z.string().nullable().optional(),
		fromAddress: z.string().nullable().optional()
	})
	.superRefine((value, ctx) => {
		if (!value.enabled) return;

		if (!value.host?.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SMTP host is required when email sending is enabled.', path: ['host'] });
		}
		if (!value.fromName?.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'From name is required when email sending is enabled.', path: ['fromName'] });
		}
		const fromAddress = value.fromAddress?.trim() ?? '';
		if (!z.string().email().safeParse(fromAddress).success) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'From address must be a valid email when email sending is enabled.',
				path: ['fromAddress']
			});
		}
	});

export const smtpTestEmailSchema = z.object({
	to: z.string().email()
});

export type UpdateSmtpSettingsInput = z.infer<typeof updateSmtpSettingsSchema>;
export type SmtpTestEmailInput = z.infer<typeof smtpTestEmailSchema>;

export class SmtpSettingsDto {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;

	@ApiProperty({ type: String })
	host!: string;

	@ApiProperty({ type: Number })
	port!: number;

	@ApiProperty({ type: Boolean })
	secure!: boolean;

	@ApiProperty({ type: String, nullable: true })
	user!: string | null;

	@ApiProperty({ type: Boolean })
	hasPassword!: boolean;

	@ApiProperty({ type: String })
	fromName!: string;

	@ApiProperty({ type: String })
	fromAddress!: string;

	@ApiProperty({ enum: ['db', 'env-default'] })
	source!: 'db' | 'env-default';
}

export class UpdateSmtpSettingsDto implements UpdateSmtpSettingsInput {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;

	@ApiProperty({ type: String, nullable: true, required: false })
	host?: string | null;

	@ApiProperty({ type: Number, minimum: 1, maximum: 65_535 })
	port!: number;

	@ApiProperty({ type: Boolean })
	secure!: boolean;

	@ApiProperty({ type: String, nullable: true, required: false })
	user?: string | null;

	@ApiProperty({ type: String, nullable: true, required: false, writeOnly: true })
	password?: string | null;

	@ApiProperty({ type: String, nullable: true, required: false })
	fromName?: string | null;

	@ApiProperty({ type: String, nullable: true, required: false })
	fromAddress?: string | null;
}

export class SmtpTestEmailDto implements SmtpTestEmailInput {
	@ApiProperty({ type: String, format: 'email' })
	to!: string;
}

export class SmtpTestResultDto {
	@ApiProperty({ type: Boolean })
	ok!: boolean;

	@ApiProperty({ type: String, required: false })
	messageId?: string;

	@ApiProperty({ type: String, required: false })
	error?: string;
}
