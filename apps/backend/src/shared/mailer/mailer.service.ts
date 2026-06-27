import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { BackendConfigService } from '../config/backend-config.service.js';
import { SettingsService } from '../settings/settings.service.js';

export const SMTP_SETTINGS_KEY = 'smtp';

export interface SmtpSettings {
	enabled: boolean;
	host: string | null;
	port: number | null;
	secure: boolean | null;
	user: string | null;
	password: string | null;
	fromName: string | null;
	fromAddress: string | null;
}

export interface EffectiveSmtpConfig {
	enabled: boolean;
	host: string | null;
	port: number;
	secure: boolean;
	user: string | null;
	password: string | null;
	fromName: string;
	fromAddress: string;
	source: 'db' | 'env-default';
	hasPassword: boolean;
}

interface MailMessage {
	to: string;
	subject: string;
	html: string;
	text: string;
}

@Injectable()
export class MailerService {
	constructor(
		private readonly config: BackendConfigService,
		private readonly settings: SettingsService
	) {}

	async getEffectiveSmtpConfig(): Promise<EffectiveSmtpConfig> {
		const stored = await this.settings.get<Partial<SmtpSettings>>(SMTP_SETTINGS_KEY);
		const env = this.config.smtp;
		const password = stored?.password ?? env.password ?? null;

		return {
			enabled: stored?.enabled ?? false,
			host: stored?.host ?? env.host ?? null,
			port: stored?.port ?? env.port,
			secure: stored?.secure ?? env.secure,
			user: stored?.user ?? env.user ?? null,
			password,
			fromName: stored?.fromName ?? env.fromName,
			fromAddress: stored?.fromAddress ?? env.fromAddress,
			source: stored ? 'db' : 'env-default',
			hasPassword: Boolean(password)
		};
	}

	async sendInviteEmail(params: { to: string; acceptUrl: string; invitedByName: string | null; expiresInDays: number }): Promise<string> {
		const { to, acceptUrl, invitedByName, expiresInDays } = params;
		const inviter = invitedByName ? `${invitedByName} has invited you` : 'You have been invited';
		const subject = "You've been invited to kubwave";
		const text = `${inviter} to join kubwave.\n\nAccept your invitation and set up your account:\n${acceptUrl}\n\nThis link expires in ${expiresInDays} days.`;
		const html = this.mailLayout(
			"You've been invited to kubwave",
			`<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">${inviter} to join <strong>kubwave</strong>. Click the button below to set up your account.</p>
		<p style="margin:0 0 24px;"><a href="${acceptUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">Accept invitation</a></p>
		<p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">Or paste this link into your browser:<br /><a href="${acceptUrl}" style="color:#16a34a;word-break:break-all;">${acceptUrl}</a></p>
		<p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;">This link expires in ${expiresInDays} days.</p>`
		);

		return this.sendMail({ to, subject, html, text });
	}

	async sendTestEmail(to: string): Promise<string> {
		const subject = 'kubwave SMTP test';
		const text = 'This is a test email from your kubwave control plane. If you received this, your SMTP settings are working.';
		const html = this.mailLayout(
			'SMTP test',
			`<p style="margin:0;font-size:14px;line-height:1.6;color:#3f3f46;">This is a test email from your kubwave control plane. If you received this, your SMTP settings are working.</p>`
		);

		return this.sendMail({ to, subject, html, text });
	}

	private async sendMail(message: MailMessage): Promise<string> {
		const cfg = await this.getEffectiveSmtpConfig();
		if (!cfg.enabled) throw new Error('SMTP is disabled');

		const transport = this.buildMailTransport(cfg);
		const info = await transport.sendMail({
			from: `"${cfg.fromName}" <${cfg.fromAddress}>`,
			to: message.to,
			subject: message.subject,
			html: message.html,
			text: message.text
		});

		return info.messageId as string;
	}

	private buildMailTransport(cfg: EffectiveSmtpConfig): Transporter {
		if (!cfg.host) throw new Error('SMTP host is not configured');
		return nodemailer.createTransport({
			host: cfg.host,
			port: cfg.port,
			secure: cfg.port === 465 ? true : cfg.secure,
			auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? '' } : undefined
		});
	}

	private mailLayout(title: string, bodyHtml: string): string {
		return `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
		<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e4e4e7;">
			<h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${title}</h1>
			${bodyHtml}
		</div>
	</body>
</html>`;
	}
}
