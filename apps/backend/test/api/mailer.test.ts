import { describe, expect, test } from 'bun:test';
import type { BackendConfigService, SmtpEnvConfig } from '~/shared/config/backend-config.service';
import { MailerService } from '~/shared/mailer/mailer.service';
import type { SettingsService } from '~/shared/settings/settings.service';

// getEffectiveSmtpConfig is now a MailerService method reading settings.get() + config.smtp.
// Stub both: config.smtp stands in for the SMTP env defaults, settings.get for the stored row.
const envSmtp: SmtpEnvConfig = {
	host: 'smtp.env.example',
	port: 1025,
	secure: false,
	user: undefined,
	password: undefined,
	fromAddress: 'noreply@kubwave.local',
	fromName: 'kubwave'
};

function makeMailer(stored: unknown): MailerService {
	const config = { smtp: envSmtp } as unknown as BackendConfigService;
	const settings = { get: async () => stored } as unknown as SettingsService;
	return new MailerService(config, settings);
}

describe('getEffectiveSmtpConfig', () => {
	test('defaults email sending to disabled even when SMTP env defaults exist', async () => {
		const cfg = await makeMailer(null).getEffectiveSmtpConfig();

		expect(cfg.enabled).toBe(false);
		expect(cfg.host).toBe('smtp.env.example');
		expect(cfg.source).toBe('env-default');
	});

	test('keeps an explicit stored SMTP enabled flag', async () => {
		const cfg = await makeMailer({
			enabled: true,
			host: 'smtp.db.example',
			port: 465,
			secure: true,
			fromName: 'kubwave',
			fromAddress: 'noreply@example.com'
		}).getEffectiveSmtpConfig();

		expect(cfg.enabled).toBe(true);
		expect(cfg.host).toBe('smtp.db.example');
		expect(cfg.source).toBe('db');
	});
});
