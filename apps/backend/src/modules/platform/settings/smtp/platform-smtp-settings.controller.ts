import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../../../shared/auth/auth.guard.js';
import { ZodValidationPipe } from '../../../../shared/validation/zod-validation.pipe.js';
import {
	SmtpSettingsDto,
	SmtpTestEmailDto,
	SmtpTestResultDto,
	UpdateSmtpSettingsDto,
	smtpTestEmailSchema,
	updateSmtpSettingsSchema,
	type SmtpTestEmailInput,
	type UpdateSmtpSettingsInput
} from './platform-smtp-settings.dto.js';
import { PlatformSmtpSettingsService } from './platform-smtp-settings.service.js';

@ApiTags('platform-settings')
@Controller('platform/settings/smtp')
@UseGuards(AdminGuard)
@ApiBearerAuth('bearerAuth')
export class PlatformSmtpSettingsController {
	constructor(private readonly smtpSettings: PlatformSmtpSettingsService) {}

	@Get()
	@ApiOperation({ operationId: 'platformSettingsSmtpGet', summary: 'Get SMTP settings' })
	@ApiOkResponse({ type: SmtpSettingsDto })
	getSettings(): Promise<SmtpSettingsDto> {
		return this.smtpSettings.getSettings();
	}

	@Put()
	@ApiOperation({ operationId: 'platformSettingsSmtpUpdate', summary: 'Update SMTP settings' })
	@ApiBody({ type: UpdateSmtpSettingsDto })
	@ApiOkResponse({ type: SmtpSettingsDto })
	updateSettings(@Body(new ZodValidationPipe(updateSmtpSettingsSchema)) body: UpdateSmtpSettingsInput): Promise<SmtpSettingsDto> {
		return this.smtpSettings.updateSettings(body);
	}

	@Post('test')
	@HttpCode(200)
	@ApiOperation({ operationId: 'platformSettingsSmtpTest', summary: 'Send a SMTP test email' })
	@ApiBody({ type: SmtpTestEmailDto })
	@ApiOkResponse({ type: SmtpTestResultDto })
	testSmtp(@Body(new ZodValidationPipe(smtpTestEmailSchema)) body: SmtpTestEmailInput): Promise<SmtpTestResultDto> {
		return this.smtpSettings.sendTestEmail(body.to);
	}
}
