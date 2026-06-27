import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import type { CatalogTemplate } from '@kubwave/templates';

export const templateIdParamSchema = z.object({ templateId: z.string().trim().min(1).max(100) });
export type TemplateIdParam = z.infer<typeof templateIdParamSchema>;

export const createFromTemplateSchema = z.object({
	templateId: z.string().trim().min(1).max(100),
	name: z.string().trim().min(1).max(100).optional(),
	inputs: z.record(z.string(), z.string()).optional()
});
export type CreateFromTemplateInput = z.infer<typeof createFromTemplateSchema>;

export class TemplateInputDto {
	@ApiProperty({ type: String }) key!: string;
	@ApiProperty({ type: String }) label!: string;
	@ApiProperty({ type: String }) type!: string;
	@ApiProperty({ type: Boolean }) required!: boolean;
	@ApiPropertyOptional({ type: String }) default?: string;
	@ApiPropertyOptional({ type: String }) placeholder?: string;
}

export class TemplateDto {
	@ApiProperty({ type: String }) id!: string;
	@ApiProperty({ type: String }) name!: string;
	@ApiProperty({ type: String }) description!: string;
	@ApiProperty({ type: String }) category!: string;
	@ApiProperty({ type: [String] }) tags!: string[];
	@ApiProperty({ type: String }) logoUrl!: string;
	@ApiProperty({ type: String }) documentation!: string;
	@ApiProperty({ type: Number }) version!: number;
	@ApiProperty({ type: [TemplateInputDto] }) inputs!: TemplateInputDto[];
}

export class CreateFromTemplateDto {
	@ApiProperty({ type: String }) templateId!: string;
	@ApiPropertyOptional({ type: String }) name?: string;
	@ApiPropertyOptional({ type: Object, additionalProperties: { type: 'string' } }) inputs?: Record<string, string>;
}

// Maps a catalog entry to the public DTO (drops logoSvg + service internals; logo via URL).
export function toTemplateDto(template: CatalogTemplate): TemplateDto {
	return {
		id: template.id,
		name: template.name,
		description: template.description,
		category: template.category,
		tags: template.tags,
		logoUrl: `/api/templates/${template.id}/logo`,
		documentation: template.documentation,
		version: template.version,
		inputs: template.inputs.map(i => ({
			key: i.key,
			label: i.label,
			type: i.type,
			required: i.required,
			default: i.default,
			placeholder: i.placeholder
		}))
	};
}
