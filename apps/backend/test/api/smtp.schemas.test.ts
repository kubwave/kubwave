import { describe, expect, test } from 'bun:test';
import { updateSmtpSettingsSchema } from '~/modules/platform/settings/smtp/platform-smtp-settings.dto';

describe('smtp schemas', () => {
	test('accepts enabled SMTP settings with host and sender', () => {
		expect(
			updateSmtpSettingsSchema.parse({
				enabled: true,
				host: 'smtp.example.com',
				port: 587,
				secure: false,
				user: null,
				fromName: 'kubwave',
				fromAddress: 'noreply@example.com'
			})
		).toEqual({
			enabled: true,
			host: 'smtp.example.com',
			port: 587,
			secure: false,
			user: null,
			fromName: 'kubwave',
			fromAddress: 'noreply@example.com'
		});
	});

	test('requires SMTP connection details when email sending is enabled', () => {
		expect(() =>
			updateSmtpSettingsSchema.parse({
				enabled: true,
				host: '',
				port: 587,
				secure: false,
				fromName: '',
				fromAddress: 'invalid'
			})
		).toThrow();
	});

	test('accepts blank SMTP details when email sending is disabled', () => {
		expect(
			updateSmtpSettingsSchema.parse({
				enabled: false,
				host: '',
				port: 1025,
				secure: false,
				fromName: '',
				fromAddress: ''
			})
		).toEqual({
			enabled: false,
			host: '',
			port: 1025,
			secure: false,
			fromName: '',
			fromAddress: ''
		});
	});
});
