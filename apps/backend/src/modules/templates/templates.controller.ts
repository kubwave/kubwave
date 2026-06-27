import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../shared/auth/auth.guard.js';
import { CurrentUserId } from '../../shared/auth/current-user.decorator.js';
import { ApiError } from '../../shared/errors/api-error.js';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe.js';
import { ServiceViewDto, environmentServiceParamSchema, type EnvironmentServiceParam } from '../services/services.dto.js';
import { TemplateCatalogService } from './template-catalog.service.js';
import { TemplatesService } from './templates.service.js';
import {
	CreateFromTemplateDto,
	TemplateDto,
	createFromTemplateSchema,
	templateIdParamSchema,
	toTemplateDto,
	type CreateFromTemplateInput,
	type TemplateIdParam
} from './templates.dto.js';

@ApiTags('templates')
@Controller()
export class TemplatesController {
	constructor(
		private readonly catalog: TemplateCatalogService,
		private readonly templates: TemplatesService
	) {}

	@Get('templates')
	@ApiOperation({ operationId: 'templatesList', summary: 'List available service templates' })
	@ApiOkResponse({ type: [TemplateDto] })
	async list(): Promise<TemplateDto[]> {
		return (await this.catalog.getCatalog()).map(toTemplateDto);
	}

	@Get('templates/:templateId')
	@ApiOperation({ operationId: 'templatesGet', summary: 'Get a single service template' })
	@ApiOkResponse({ type: TemplateDto })
	async get(@Param(new ZodValidationPipe(templateIdParamSchema)) params: TemplateIdParam): Promise<TemplateDto> {
		const template = await this.catalog.getTemplate(params.templateId);
		if (!template) throw new ApiError(404, 'template_not_found');
		return toTemplateDto(template);
	}

	@Get('templates/:templateId/logo')
	@ApiOperation({ operationId: 'templatesLogo', summary: 'Get a template logo (SVG)' })
	@Header('Content-Type', 'image/svg+xml')
	@Header('Cache-Control', 'public, max-age=3600')
	@Header('X-Content-Type-Options', 'nosniff')
	@Header('Content-Disposition', 'inline')
	async logo(@Param(new ZodValidationPipe(templateIdParamSchema)) params: TemplateIdParam): Promise<string> {
		const template = await this.catalog.getTemplate(params.templateId);
		if (!template) throw new ApiError(404, 'template_not_found');
		return template.logoSvg;
	}

	@Post('environments/:environmentId/services/from-template')
	@UseGuards(AuthGuard)
	@ApiBearerAuth('bearerAuth')
	@ApiOperation({ operationId: 'environmentServicesCreateFromTemplate', summary: 'Create services from a template' })
	@ApiBody({ type: CreateFromTemplateDto })
	@ApiCreatedResponse({ type: [ServiceViewDto] })
	async fromTemplate(
		@CurrentUserId() userId: string,
		@Param(new ZodValidationPipe(environmentServiceParamSchema)) params: EnvironmentServiceParam,
		@Body(new ZodValidationPipe(createFromTemplateSchema)) body: CreateFromTemplateInput
	): Promise<ServiceViewDto[]> {
		return this.templates.instantiate(userId, params.environmentId, body.templateId, body.name, body.inputs ?? {});
	}
}
