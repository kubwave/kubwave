import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { AiProvider } from '../../../services/analyze/llm.js';

const AI_PROVIDERS = ['anthropic', 'openai-compatible'] as const;

export const updateAiSettingsSchema = z
	.object({
		enabled: z.boolean(),
		provider: z.enum(AI_PROVIDERS),
		baseUrl: z
			.string()
			.trim()
			.max(512)
			.regex(/^https?:\/\/\S+$/i, 'Enter an http(s) URL.')
			.or(z.literal(''))
			.nullable()
			.optional(),
		model: z.string().trim().max(200),
		// Write-only: empty or absent keeps the stored key.
		apiKey: z.string().max(4000).nullable().optional()
	})
	.superRefine((value, ctx) => {
		if (!value.enabled) return;
		if (!value.model) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A model is required when AI is enabled.', path: ['model'] });
		if (value.provider === 'openai-compatible' && !value.baseUrl) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'OpenAI-compatible endpoints need a base URL.', path: ['baseUrl'] });
		}
	});

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

export class AiSettingsDto {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;

	@ApiProperty({ enum: AI_PROVIDERS })
	provider!: AiProvider;

	@ApiProperty({ type: String, nullable: true })
	baseUrl!: string | null;

	@ApiProperty({ type: String, description: 'Model id with an optional ":effort" suffix, e.g. claude-opus-5:high.' })
	model!: string;

	@ApiProperty({ type: Boolean })
	hasApiKey!: boolean;
}

export class UpdateAiSettingsDto implements UpdateAiSettingsInput {
	@ApiProperty({ type: Boolean })
	enabled!: boolean;

	@ApiProperty({ enum: AI_PROVIDERS })
	provider!: AiProvider;

	@ApiProperty({ type: String, nullable: true, required: false })
	baseUrl?: string | null;

	@ApiProperty({ type: String })
	model!: string;

	@ApiProperty({ type: String, nullable: true, required: false, writeOnly: true })
	apiKey?: string | null;
}
