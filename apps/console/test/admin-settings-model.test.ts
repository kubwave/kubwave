import { describe, expect, mock, test } from 'bun:test';
import type {
	AiSettingsDto,
	DefaultDomainSettingsDto,
	MetricsSettingsDto,
	PlatformVersionInfoDto,
	RegistrySettingsDto,
	SmtpSettingsDto,
	VolumeAutoscalingSettingsDto
} from '@kubwave/api-client';
import {
	aiGroup,
	autoscalingGroup,
	concurrencyGroup,
	domainGroup,
	domainPreview,
	giteaErrorMessage,
	metricsGroup,
	prPreviewGroup,
	registryGroup,
	settingsTab,
	smtpGroup,
	tcpPoolGroup,
	updateSummary
} from '../features/admin-settings/model';
import { hasErrors, isGroupDirty, saveBarState, saveDirtyGroups, type SaveableGroup } from '../features/admin-settings/settings-group';

const smtp: SmtpSettingsDto = {
	enabled: true,
	host: 'smtp.example.com',
	port: 587,
	secure: false,
	user: 'mailer',
	hasPassword: true,
	fromName: 'kubwave',
	fromAddress: 'noreply@example.com',
	source: 'db'
};

describe('isGroupDirty', () => {
	test('an untouched draft is clean', () => {
		expect(isGroupDirty(smtpGroup, smtpGroup.toDraft(smtp), smtp)).toBe(false);
	});

	test('whitespace the payload trims away is not a change', () => {
		expect(isGroupDirty(smtpGroup, { ...smtpGroup.toDraft(smtp), host: ' smtp.example.com ' }, smtp)).toBe(false);
	});

	test('a typed write-only secret is a change', () => {
		expect(isGroupDirty(smtpGroup, { ...smtpGroup.toDraft(smtp), password: 'hunter2' }, smtp)).toBe(true);
	});

	test('nothing is dirty before the server settings arrive', () => {
		expect(isGroupDirty(smtpGroup, { ...smtpGroup.initial, host: 'x' }, undefined)).toBe(false);
	});
});

describe('save bar', () => {
	const group = (dirty: boolean, valid = true, save = mock(async () => {})): SaveableGroup & { save: typeof save } => ({ dirty, valid, save });

	test('counts dirty groups and blocks saving while a dirty group is invalid', () => {
		expect(saveBarState([group(true), group(false, false), group(true)])).toEqual({ changes: 2, blocked: false });
		expect(saveBarState([group(true, false), group(false)])).toEqual({ changes: 1, blocked: true });
	});

	test('saves only dirty groups and lets the others finish when one fails', async () => {
		const clean = group(false);
		const ok = group(true);
		const failing = group(
			true,
			true,
			mock(async () => {
				throw new Error('boom');
			})
		);
		const results = await saveDirtyGroups([clean, failing, ok]);
		expect(clean.save).not.toHaveBeenCalled();
		expect(ok.save).toHaveBeenCalledTimes(1);
		expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled']);
	});

	test('hasErrors ignores fields without a message', () => {
		expect(hasErrors({ host: undefined })).toBe(false);
		expect(hasErrors({ host: 'Enter a host.' })).toBe(true);
	});
});

describe('scaling groups', () => {
	test('whole-number limits are validated from the text input', () => {
		expect(concurrencyGroup.errors?.({ maxConcurrentDeployments: '0' }, { maxConcurrentDeployments: 3 })).toEqual({
			maxConcurrentDeployments: 'Enter a whole number from 1 to 20.'
		});
		expect(prPreviewGroup.errors?.({ maxPreviewsPerProject: '' }, { maxPreviewsPerProject: 5 }).maxPreviewsPerProject).toBeDefined();
		expect(prPreviewGroup.toPayload({ maxPreviewsPerProject: '0' })).toEqual({ maxPreviewsPerProject: 0 });
	});

	const autoscaling: VolumeAutoscalingSettingsDto = {
		enabled: true,
		thresholdPercent: 80,
		growthPercent: 50,
		caps: { postgres: '100Gi', registry: '200Gi', prometheus: '50Gi' }
	};

	test('autoscaling maps caps to and from the flat draft', () => {
		const draft = autoscalingGroup(true).toDraft(autoscaling);
		expect(draft).toEqual({
			enabled: true,
			thresholdPercent: '80',
			growthPercent: '50',
			postgresCap: '100Gi',
			registryCap: '200Gi',
			prometheusCap: '50Gi'
		});
		expect(autoscalingGroup(true).toPayload(draft)).toEqual(autoscaling);
	});

	test('autoscaling caps are whole Gi of at least 10, the registry cap only when the platform registry is used', () => {
		const draft = { ...autoscalingGroup(true).toDraft(autoscaling), postgresCap: '5Gi', registryCap: '1Ti', thresholdPercent: '99' };
		expect(autoscalingGroup(true).errors?.(draft, autoscaling)).toMatchObject({
			postgresCap: 'Use whole Gi of at least 10Gi, like "100Gi".',
			registryCap: 'Use whole Gi of at least 10Gi, like "100Gi".',
			thresholdPercent: 'Enter a whole number from 50 to 95.'
		});
		expect(autoscalingGroup(false).errors?.(draft, autoscaling)?.registryCap).toBeUndefined();
	});

	test('the TCP pool must end at or below port 65535', () => {
		const settings = { enabled: true, start: 30100, size: 20 };
		expect(tcpPoolGroup.errors?.({ enabled: true, start: '65530', size: '10' }, settings)).toEqual({
			start: undefined,
			size: 'The pool must end at or below port 65535.'
		});
		expect(tcpPoolGroup.errors?.({ enabled: true, start: '80', size: '10' }, settings)?.start).toBe('Enter a whole number from 1024 to 65535.');
		expect(tcpPoolGroup.toPayload({ enabled: false, start: '30100', size: '20' })).toEqual({ enabled: false, start: 30100, size: 20 });
	});
});

describe('integration groups', () => {
	const domain: DefaultDomainSettingsDto = { mode: 'sslip', base: 'stale.example.com', subdomainTemplate: null, effectiveBase: '1-2-3-4.sslip.io' };

	test('domain sends the base only in wildcard mode, so a stale stored base never looks dirty', () => {
		expect(isGroupDirty(domainGroup, domainGroup.toDraft(domain), domain)).toBe(false);
		expect(domainGroup.toPayload({ mode: 'wildcard', base: ' apps.example.com ', subdomainTemplate: ' ' })).toEqual({
			mode: 'wildcard',
			base: 'apps.example.com',
			subdomainTemplate: null
		});
		expect(domainGroup.errors?.({ mode: 'wildcard', base: '', subdomainTemplate: '' }, domain)?.base).toBe('Enter a base domain for wildcard mode.');
	});

	test('the domain preview fills the default template like the server', () => {
		expect(domainPreview('', 'apps.example.com')).toBe('my-service-1a2b3c4d.apps.example.com');
		expect(domainPreview('{name}', '')).toBe('my-service.apps.mycloud.com');
	});

	test('smtp omits a blank password so the stored one is kept, and validates only while enabled', () => {
		const draft = smtpGroup.toDraft(smtp);
		expect(smtpGroup.toPayload({ ...draft, user: ' ' })).toEqual({
			enabled: true,
			host: 'smtp.example.com',
			port: 587,
			secure: false,
			user: null,
			password: undefined,
			fromName: 'kubwave',
			fromAddress: 'noreply@example.com'
		});
		const broken = { ...draft, host: '', fromAddress: 'nope', port: '70000' };
		expect(smtpGroup.errors?.(broken, smtp)).toMatchObject({
			host: 'Enter a host.',
			port: 'Enter a whole number from 1 to 65535.',
			fromAddress: 'Enter a valid email address.'
		});
		expect(hasErrors(smtpGroup.errors?.({ ...broken, enabled: false, port: '25' }, smtp) ?? {})).toBe(false);
	});

	test('metrics requires a URL only for an external Prometheus', () => {
		const settings: MetricsSettingsDto = { provider: 'live', prometheusUrl: null };
		expect(metricsGroup.errors?.({ provider: 'prometheus-external', prometheusUrl: ' ' }, settings)?.prometheusUrl).toBe('Enter the Prometheus URL.');
		expect(metricsGroup.toPayload({ provider: 'prometheus-managed', prometheusUrl: 'http://old' })).toEqual({
			provider: 'prometheus-managed',
			prometheusUrl: null
		});
	});

	test('ai needs a model when enabled and an endpoint for OpenAI-compatible providers', () => {
		const settings: AiSettingsDto = { enabled: false, provider: 'anthropic', baseUrl: null, model: '', hasApiKey: false };
		const draft = { enabled: true, provider: 'openai-compatible' as const, baseUrl: '', model: '', apiKey: '' };
		expect(aiGroup.errors?.(draft, settings)).toEqual({ model: 'Enter a model id.', baseUrl: 'Enter an http(s) URL.' });
		expect(aiGroup.errors?.({ ...draft, provider: 'anthropic', model: 'claude-opus-5' }, settings)).toEqual({ model: undefined, baseUrl: undefined });
		expect(aiGroup.toPayload({ ...draft, apiKey: 'sk-1', model: ' gpt-5 ' })).toEqual({
			enabled: true,
			provider: 'openai-compatible',
			baseUrl: null,
			model: 'gpt-5',
			apiKey: 'sk-1'
		});
	});

	test('registry reuses the shared registry model and treats an unconfigured registry as the managed one', () => {
		const settings: RegistrySettingsDto = {
			mode: 'unconfigured',
			endpoint: null,
			insecure: false,
			username: null,
			hasPassword: true,
			applyStatus: 'not_configured',
			activeRunId: null,
			lastError: null
		};
		expect(isGroupDirty(registryGroup, registryGroup.toDraft(settings), settings)).toBe(false);
		expect(registryGroup.errors?.({ mode: 'external', endpoint: 'ghcr.io/acme', insecure: false, username: 'bot', password: '' }, settings)).toEqual(
			{}
		);
	});
});

describe('gitea errors', () => {
	test('explains an unreachable instance and invalid URLs', () => {
		expect(giteaErrorMessage({ error: 'gitea_unreachable' })).toContain('could not reach that Gitea instance');
		expect(giteaErrorMessage({ error: 'gitea_unreachable', details: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
		expect(giteaErrorMessage({ error: 'invalid_gitea_url' })).toBe('Enter a valid http(s) instance URL without credentials.');
		expect(giteaErrorMessage({ error: 'oauth_failed', details: 'bad secret' })).toBe('oauth_failed: bad secret');
		expect(giteaErrorMessage(new Error('x'))).toBe('Could not connect Gitea.');
	});
});

describe('settingsTab', () => {
	test('reads the tab from the URL and falls back to system', () => {
		expect(settingsTab('network', false)).toBe('network');
		expect(settingsTab('bogus', false)).toBe('system');
		expect(settingsTab(undefined, false)).toBe('system');
	});

	test('a GitHub App callback always lands on integrations', () => {
		expect(settingsTab('system', true)).toBe('integrations');
	});
});

describe('updateSummary', () => {
	const info: PlatformVersionInfoDto = {
		currentVersion: '1.2.0',
		latestVersion: '1.3.0',
		availableVersions: [{ version: '1.3.0', changelogUrl: 'https://example.com/1.3.0', publishedAt: null }],
		lastCheckedAt: null
	};

	test('offers the latest release with its changelog', () => {
		expect(updateSummary(info)).toEqual({ available: true, latest: '1.3.0', changelogUrl: 'https://example.com/1.3.0' });
	});

	test('is up to date when latest equals current or is unknown', () => {
		expect(updateSummary({ ...info, latestVersion: '1.2.0' }).available).toBe(false);
		expect(updateSummary({ ...info, latestVersion: null })).toEqual({ available: false, latest: null, changelogUrl: null });
		expect(updateSummary(undefined).available).toBe(false);
	});
});
