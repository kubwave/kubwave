import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { DefaultDomainMode } from '@kubwave/db';

const domainRegex = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

export const defaultDomainModeSchema = z.enum(['off', 'wildcard', 'sslip']);

export const updateDefaultDomainSettingsSchema = z
	.object({
		mode: defaultDomainModeSchema,
		base: z.string().trim().regex(domainRegex, 'Enter a valid base domain').nullable().optional(),
		subdomainTemplate: z
			.string()
			.trim()
			.min(1)
			.max(63)
			.regex(/^[a-z0-9{}-]+$/, 'Use lowercase letters, digits, dashes, and the {name}/{shortId} tokens')
			.nullable()
			.optional()
	})
	.superRefine((value, ctx) => {
		if (value.mode === 'wildcard' && !value.base) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A base domain is required for wildcard mode.', path: ['base'] });
		}

		if (value.subdomainTemplate) {
			const leftover = value.subdomainTemplate.replaceAll('{name}', '').replaceAll('{shortId}', '');
			if (leftover.includes('{') || leftover.includes('}')) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only the {name} and {shortId} tokens are allowed.', path: ['subdomainTemplate'] });
			}
		}
	});

export type UpdateDefaultDomainSettingsInput = z.infer<typeof updateDefaultDomainSettingsSchema>;

export class DefaultDomainSettingsDto {
	@ApiProperty({ enum: ['off', 'wildcard', 'sslip'] })
	mode!: DefaultDomainMode;

	@ApiProperty({ type: String, nullable: true })
	base!: string | null;

	@ApiProperty({ type: String, nullable: true })
	subdomainTemplate!: string | null;

	@ApiProperty({ type: String, nullable: true })
	effectiveBase!: string | null;
}

export class UpdateDefaultDomainSettingsDto implements UpdateDefaultDomainSettingsInput {
	@ApiProperty({ enum: ['off', 'wildcard', 'sslip'] })
	mode!: DefaultDomainMode;

	@ApiProperty({ type: String, nullable: true, required: false })
	base?: string | null;

	@ApiProperty({ type: String, nullable: true, required: false })
	subdomainTemplate?: string | null;
}
