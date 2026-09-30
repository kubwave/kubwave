import type {
	AiSettingsDto,
	DefaultDomainSettingsDto,
	DeploymentConcurrencySettingsDto,
	HaSettingsDto,
	MetricsSettingsDto,
	PlatformSettingsAiUpdateData,
	PlatformSettingsDomainUpdateData,
	PlatformSettingsMetricsUpdateData,
	PlatformSettingsSmtpUpdateData,
	PlatformSettingsTcpPortPoolUpdateData,
	PlatformVersionInfoDto,
	PrPreviewSettingsDto,
	RegistrySettingsDto,
	SmtpSettingsDto,
	TcpPortPoolSettingsDto,
	VolumeAutoscalingSettingsDto
} from '@kubwave/api-client';
import { registryDraftFrom, registryErrors, registryPayload, type RegistryDraft, type RegistryPayload } from '@/features/platform/registry-model';
import type { GroupSpec } from './settings-group';

export const SETTINGS_TABS = ['system', 'scaling', 'network', 'integrations', 'builds'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

// The GitHub App manifest callback returns with ?connected=1 or ?git_error=, which belong to the integrations tab.
export function settingsTab(requested: string | undefined, fromGitCallback: boolean): SettingsTab {
	if (fromGitCallback) return 'integrations';
	return SETTINGS_TABS.find(tab => tab === requested) ?? 'system';
}

export function updateSummary(info: PlatformVersionInfoDto | undefined) {
	const latest = info?.latestVersion ?? null;
	return {
		available: Boolean(latest && info?.currentVersion && latest !== info.currentVersion),
		latest,
		changelogUrl: info?.availableVersions.find(release => release.version === latest)?.changelogUrl ?? null
	};
}

function wholeNumberError(value: string, min: number, max: number): string | undefined {
	const n = Number(value);
	return value.trim() === '' || !Number.isInteger(n) || n < min || n > max ? `Enter a whole number from ${min} to ${max}.` : undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string) => EMAIL.test(value.trim());

export const haGroup: GroupSpec<HaSettingsDto, { enabled: boolean }, HaSettingsDto> = {
	initial: { enabled: false },
	toDraft: settings => ({ enabled: settings.enabled }),
	toPayload: draft => ({ enabled: draft.enabled })
};

export const concurrencyGroup: GroupSpec<DeploymentConcurrencySettingsDto, { maxConcurrentDeployments: string }, DeploymentConcurrencySettingsDto> = {
	initial: { maxConcurrentDeployments: '3' },
	toDraft: settings => ({ maxConcurrentDeployments: String(settings.maxConcurrentDeployments) }),
	toPayload: draft => ({ maxConcurrentDeployments: Number(draft.maxConcurrentDeployments) }),
	errors: draft => ({ maxConcurrentDeployments: wholeNumberError(draft.maxConcurrentDeployments, 1, 20) })
};

export const prPreviewGroup: GroupSpec<PrPreviewSettingsDto, { maxPreviewsPerProject: string }, PrPreviewSettingsDto> = {
	initial: { maxPreviewsPerProject: '5' },
	toDraft: settings => ({ maxPreviewsPerProject: String(settings.maxPreviewsPerProject) }),
	toPayload: draft => ({ maxPreviewsPerProject: Number(draft.maxPreviewsPerProject) }),
	errors: draft => ({ maxPreviewsPerProject: wholeNumberError(draft.maxPreviewsPerProject, 0, 100) })
};

type AutoscalingDraft = {
	enabled: boolean;
	thresholdPercent: string;
	growthPercent: string;
	postgresCap: string;
	registryCap: string;
	prometheusCap: string;
};

function capError(value: string): string | undefined {
	return /^\d+Gi$/.test(value) && Number(value.slice(0, -2)) >= 10 ? undefined : 'Use whole Gi of at least 10Gi, like "100Gi".';
}

// The registry cap only matters (and is only shown) while the platform runs its own registry.
export function autoscalingGroup(
	requireRegistryCap: boolean
): GroupSpec<VolumeAutoscalingSettingsDto, AutoscalingDraft, VolumeAutoscalingSettingsDto> {
	return {
		initial: { enabled: false, thresholdPercent: '80', growthPercent: '50', postgresCap: '100Gi', registryCap: '200Gi', prometheusCap: '50Gi' },
		toDraft: settings => ({
			enabled: settings.enabled,
			thresholdPercent: String(settings.thresholdPercent),
			growthPercent: String(settings.growthPercent),
			postgresCap: settings.caps.postgres,
			registryCap: settings.caps.registry,
			prometheusCap: settings.caps.prometheus
		}),
		toPayload: draft => ({
			enabled: draft.enabled,
			thresholdPercent: Number(draft.thresholdPercent),
			growthPercent: Number(draft.growthPercent),
			caps: { postgres: draft.postgresCap, registry: draft.registryCap, prometheus: draft.prometheusCap }
		}),
		errors: draft => ({
			thresholdPercent: wholeNumberError(draft.thresholdPercent, 50, 95),
			growthPercent: wholeNumberError(draft.growthPercent, 10, 100),
			postgresCap: capError(draft.postgresCap),
			registryCap: requireRegistryCap ? capError(draft.registryCap) : undefined,
			prometheusCap: capError(draft.prometheusCap)
		})
	};
}

type TcpPoolPayload = PlatformSettingsTcpPortPoolUpdateData['body'];

export const tcpPoolGroup: GroupSpec<TcpPortPoolSettingsDto, { enabled: boolean; start: string; size: string }, TcpPoolPayload> = {
	initial: { enabled: true, start: '30100', size: '20' },
	toDraft: settings => ({ enabled: settings.enabled, start: String(settings.start), size: String(settings.size) }),
	toPayload: draft => ({ enabled: draft.enabled, start: Number(draft.start), size: Number(draft.size) }),
	errors: draft => {
		const start = wholeNumberError(draft.start, 1024, 65535);
		const size = wholeNumberError(draft.size, 1, 100);
		const overflows = !start && !size && Number(draft.start) + Number(draft.size) - 1 > 65535;
		return { start, size: overflows ? 'The pool must end at or below port 65535.' : size };
	}
};

type DomainDraft = { mode: DefaultDomainSettingsDto['mode']; base: string; subdomainTemplate: string };

export const domainGroup: GroupSpec<DefaultDomainSettingsDto, DomainDraft, PlatformSettingsDomainUpdateData['body']> = {
	initial: { mode: 'sslip', base: '', subdomainTemplate: '' },
	toDraft: settings => ({ mode: settings.mode, base: settings.base ?? '', subdomainTemplate: settings.subdomainTemplate ?? '' }),
	toPayload: draft => ({
		mode: draft.mode,
		base: draft.mode === 'wildcard' ? draft.base.trim() : null,
		subdomainTemplate: draft.subdomainTemplate.trim() || null
	}),
	errors: draft => ({ base: draft.mode === 'wildcard' && !draft.base.trim() ? 'Enter a base domain for wildcard mode.' : undefined })
};

// Mirrors the server's default template and label sanitization, for the live preview only.
export function domainPreview(template: string, base: string): string {
	const label = (template.trim() || '{name}-{shortId}').replace('{name}', 'my-service').replace('{shortId}', '1a2b3c4d');
	return `${label}.${base.trim() || 'apps.mycloud.com'}`;
}

type SmtpDraft = {
	enabled: boolean;
	host: string;
	port: string;
	secure: boolean;
	user: string;
	password: string;
	fromName: string;
	fromAddress: string;
};

// The stored password is write-only: the draft starts empty and a blank password keeps it.
export const smtpGroup: GroupSpec<SmtpSettingsDto, SmtpDraft, PlatformSettingsSmtpUpdateData['body']> = {
	initial: { enabled: true, host: '', port: '1025', secure: false, user: '', password: '', fromName: '', fromAddress: '' },
	toDraft: settings => ({
		enabled: settings.enabled,
		host: settings.host,
		port: String(settings.port),
		secure: settings.secure,
		user: settings.user ?? '',
		password: '',
		fromName: settings.fromName,
		fromAddress: settings.fromAddress
	}),
	toPayload: draft => ({
		enabled: draft.enabled,
		host: draft.host.trim(),
		port: Number(draft.port),
		secure: draft.secure,
		user: draft.user.trim() || null,
		password: draft.password || undefined,
		fromName: draft.fromName.trim(),
		fromAddress: draft.fromAddress.trim()
	}),
	errors: draft => ({
		host: draft.enabled && !draft.host.trim() ? 'Enter a host.' : undefined,
		port: wholeNumberError(draft.port, 1, 65535),
		fromName: draft.enabled && !draft.fromName.trim() ? 'Enter a from name.' : undefined,
		fromAddress: draft.enabled && !isEmail(draft.fromAddress) ? 'Enter a valid email address.' : undefined
	})
};

type MetricsDraft = { provider: MetricsSettingsDto['provider']; prometheusUrl: string };

export const metricsGroup: GroupSpec<MetricsSettingsDto, MetricsDraft, PlatformSettingsMetricsUpdateData['body']> = {
	initial: { provider: 'live', prometheusUrl: '' },
	toDraft: settings => ({ provider: settings.provider, prometheusUrl: settings.prometheusUrl ?? '' }),
	toPayload: draft => ({
		provider: draft.provider,
		prometheusUrl: draft.provider === 'prometheus-external' ? draft.prometheusUrl.trim() : null
	}),
	errors: draft => ({
		prometheusUrl: draft.provider === 'prometheus-external' && !draft.prometheusUrl.trim() ? 'Enter the Prometheus URL.' : undefined
	})
};

type AiDraft = { enabled: boolean; provider: AiSettingsDto['provider']; baseUrl: string; model: string; apiKey: string };

function aiBaseUrlError(draft: AiDraft): string | undefined {
	const url = draft.baseUrl.trim();
	const ok = url ? /^https?:\/\/\S+$/i.test(url) : !draft.enabled || draft.provider === 'anthropic';
	return ok ? undefined : 'Enter an http(s) URL.';
}

export const aiGroup: GroupSpec<AiSettingsDto, AiDraft, PlatformSettingsAiUpdateData['body']> = {
	initial: { enabled: false, provider: 'anthropic', baseUrl: '', model: '', apiKey: '' },
	toDraft: settings => ({
		enabled: settings.enabled,
		provider: settings.provider,
		baseUrl: settings.baseUrl ?? '',
		model: settings.model,
		apiKey: ''
	}),
	toPayload: draft => ({
		enabled: draft.enabled,
		provider: draft.provider,
		baseUrl: draft.baseUrl.trim() || null,
		model: draft.model.trim(),
		...(draft.apiKey ? { apiKey: draft.apiKey } : {})
	}),
	errors: draft => ({ model: draft.enabled && !draft.model.trim() ? 'Enter a model id.' : undefined, baseUrl: aiBaseUrlError(draft) })
};

export const registryGroup: GroupSpec<RegistrySettingsDto, RegistryDraft, RegistryPayload> = {
	initial: { mode: 'platform', endpoint: '', insecure: false, username: '', password: '' },
	toDraft: registryDraftFrom,
	toPayload: registryPayload,
	errors: (draft, settings) => registryErrors(draft, settings.hasPassword)
};

export function giteaErrorMessage(err: unknown): string {
	const body = (err && typeof err === 'object' ? err : {}) as { error?: unknown; details?: unknown };
	const code = typeof body.error === 'string' ? body.error : null;
	const detail = typeof body.details === 'string' ? body.details : null;
	if (code === 'gitea_unreachable')
		return detail ?? 'The API could not reach that Gitea instance. Use a URL reachable from the cluster (not localhost from inside the pod).';
	if (code === 'invalid_gitea_url') return 'Enter a valid http(s) instance URL without credentials.';
	if (code && detail) return `${code}: ${detail}`;
	return code ?? 'Could not connect Gitea.';
}
