import { Injectable } from '@nestjs/common';
import { MailerService, SMTP_SETTINGS_KEY, type SmtpSettings } from '../../../../shared/mailer/mailer.service.js';
import { SettingsService } from '../../../../shared/settings/settings.service.js';
import type { SmtpSettingsDto, SmtpTestResultDto, UpdateSmtpSettingsInput } from './platform-smtp-settings.dto.js';

@Injectable()
export class PlatformSmtpSettingsService {
	constructor(
		private readonly mailer: MailerService,
		private readonly settings: SettingsService
	) {}

	async getSettings(): Promise<SmtpSettingsDto> {
		const cfg = await this.mailer.getEffectiveSmtpConfig();
		return {
			enabled: cfg.enabled,
			host: cfg.host ?? '',
			port: cfg.port,
			secure: cfg.secure,
			user: cfg.user,
			hasPassword: cfg.hasPassword,
			fromName: cfg.fromName,
			fromAddress: cfg.fromAddress,
			source: cfg.source
		};
	}

	async updateSettings(input: UpdateSmtpSettingsInput): Promise<SmtpSettingsDto> {
		const existing = await this.settings.get<Partial<SmtpSettings>>(SMTP_SETTINGS_KEY);
		const password = input.password && input.password.length > 0 ? input.password : (existing?.password ?? null);
		const next: SmtpSettings = {
			enabled: input.enabled,
			host: input.host?.trim() ?? '',
			port: input.port,
			secure: input.secure,
			user: input.user && input.user.length > 0 ? input.user : null,
			password,
			fromName: input.fromName?.trim() ?? '',
			fromAddress: input.fromAddress?.trim() ?? ''
		};

		await this.settings.set<SmtpSettings>(SMTP_SETTINGS_KEY, next);
		return this.getSettings();
	}

	async sendTestEmail(to: string): Promise<SmtpTestResultDto> {
		try {
			return { ok: true, messageId: await this.mailer.sendTestEmail(to) };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	}
}
