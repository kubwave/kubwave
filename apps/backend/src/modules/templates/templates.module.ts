import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module.js';
import { TemplateCatalogService } from './template-catalog.service.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

@Module({
	imports: [ServicesModule],
	controllers: [TemplatesController],
	providers: [TemplateCatalogService, TemplatesService]
})
export class TemplatesModule {}
