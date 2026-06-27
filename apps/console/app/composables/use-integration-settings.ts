import type { InjectionKey } from 'vue';
import type { SaveDefaultDomainInput } from '~/composables/use-admin-default-domain-settings';
import type { SaveMetricsSettingsInput } from '~/composables/use-admin-metrics-settings';
import type { SaveRegistryInput } from '~/composables/use-admin-registry-settings';
import type { SaveSmtpInput } from '~/composables/use-admin-smtp-settings';
import { composeSettingsGroups, useSettingsGroup } from '~/composables/use-settings-group';

// Page-scoped store for the Admin "Integrations" tab: one draft + one save per group (domain, registry, SMTP, metrics), writing only changed groups.

type DomainMode = 'off' | 'wildcard' | 'sslip';
type MetricsProvider = 'live' | 'prometheus-external' | 'prometheus-managed';
type RegistryMode = 'platform' | 'external';

interface DomainDraft {
	mode: DomainMode;
	base: string;
	subdomainTemplate: string;
}
interface SmtpDraft {
	enabled: boolean;
	host: string;
	port: number;
	secure: boolean;
	user: string;
	password: string;
	fromName: string;
	fromAddress: string;
}
interface MetricsDraft {
	provider: MetricsProvider;
	prometheusUrl: string;
}
interface RegistryDraft {
	mode: RegistryMode;
	endpoint: string;
	insecure: boolean;
	username: string;
	password: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-field validity predicates shared by each group's save-gating `validate` and the inline `*Valid` flags, so they can't drift.
const domainBaseOk = (d: DomainDraft) => d.mode !== 'wildcard' || d.base.trim().length > 0;
const smtpHostOk = (d: SmtpDraft) => !d.enabled || d.host.trim().length > 0;
const smtpPortOk = (d: SmtpDraft) => Number.isInteger(d.port) && d.port >= 1 && d.port <= 65535;
const smtpFromNameOk = (d: SmtpDraft) => !d.enabled || d.fromName.trim().length > 0;
const smtpFromAddressOk = (d: SmtpDraft) => !d.enabled || EMAIL_RE.test(d.fromAddress.trim());
const metricsUrlOk = (d: MetricsDraft) => d.provider !== 'prometheus-external' || d.prometheusUrl.trim().length > 0;
const registryEndpointOk = (d: RegistryDraft) => d.mode === 'platform' || d.endpoint.trim().length > 0;
const registryUsernameOk = (d: RegistryDraft) => d.mode === 'platform' || d.username.trim().length > 0;
const registryPasswordOk = (d: RegistryDraft, hasPassword: boolean) => d.mode === 'platform' || hasPassword || d.password.length > 0;

function createIntegrationSettingsStore() {
	const domain = useDefaultDomainSettings();
	const smtp = useSmtpSettings();
	const metrics = useMetricsSettings();
	const registry = useRegistrySettings();

	const domainGroup = useSettingsGroup({
		source: domain.settings,
		save: domain.save,
		initial: { mode: 'sslip', base: '', subdomainTemplate: '' } as DomainDraft,
		toDraft: (s): DomainDraft => ({ mode: s.mode, base: s.base ?? '', subdomainTemplate: s.subdomainTemplate ?? '' }),
		toPayload: (draft): SaveDefaultDomainInput => ({
			mode: draft.mode,
			base: draft.mode === 'wildcard' ? draft.base.trim() : null,
			subdomainTemplate: draft.subdomainTemplate.trim() || null
		}),
		isDirty: (draft, s) => {
			const base = draft.mode === 'wildcard' ? draft.base.trim() : null;
			const template = draft.subdomainTemplate.trim() || null;
			return draft.mode !== s.mode || base !== (s.base ?? null) || template !== (s.subdomainTemplate ?? null);
		},
		validate: domainBaseOk
	});

	const smtpGroup = useSettingsGroup({
		source: smtp.settings,
		save: smtp.save,
		initial: { enabled: true, host: '', port: 1025, secure: false, user: '', password: '', fromName: '', fromAddress: '' } as SmtpDraft,
		toDraft: (s): SmtpDraft => ({
			enabled: s.enabled,
			host: s.host,
			port: s.port,
			secure: s.secure,
			user: s.user ?? '',
			password: '',
			fromName: s.fromName,
			fromAddress: s.fromAddress
		}),
		toPayload: (draft): SaveSmtpInput => ({
			enabled: draft.enabled,
			host: draft.host.trim(),
			port: draft.port,
			secure: draft.secure,
			user: draft.user.trim() ? draft.user.trim() : null,
			// Blank password is omitted so the stored one is preserved.
			password: draft.password ? draft.password : undefined,
			fromName: draft.fromName.trim(),
			fromAddress: draft.fromAddress.trim()
		}),
		// Compare trimmed (matching toPayload) — else whitespace leaves the group permanently dirty after save.
		isDirty: (draft, s) =>
			draft.enabled !== s.enabled ||
			draft.host.trim() !== s.host ||
			draft.port !== s.port ||
			draft.secure !== s.secure ||
			(draft.user.trim() || '') !== (s.user ?? '') ||
			draft.fromName.trim() !== s.fromName ||
			draft.fromAddress.trim() !== s.fromAddress ||
			draft.password.length > 0,
		validate: draft => smtpHostOk(draft) && smtpPortOk(draft) && smtpFromNameOk(draft) && smtpFromAddressOk(draft),
		// Clear the typed password after a successful save so the group isn't dirty (or re-sent) next time.
		afterSave: draft => {
			draft.password = '';
		}
	});

	const metricsGroup = useSettingsGroup({
		source: metrics.settings,
		save: metrics.save,
		initial: { provider: 'live', prometheusUrl: '' } as MetricsDraft,
		toDraft: (s): MetricsDraft => ({ provider: s.provider, prometheusUrl: s.prometheusUrl ?? '' }),
		toPayload: (draft): SaveMetricsSettingsInput => ({
			provider: draft.provider,
			prometheusUrl: draft.provider === 'prometheus-external' ? draft.prometheusUrl.trim() : null
		}),
		isDirty: (draft, s) => {
			const url = draft.provider === 'prometheus-external' ? draft.prometheusUrl.trim() : null;
			return draft.provider !== s.provider || url !== (s.prometheusUrl ?? null);
		},
		validate: metricsUrlOk
	});

	const registryHasPassword = computed(() => registry.settings.value?.hasPassword ?? false);
	const registryGroup = useSettingsGroup({
		source: registry.settings,
		save: registry.save,
		initial: { mode: 'platform', endpoint: '', insecure: false, username: '', password: '' } as RegistryDraft,
		toDraft: (s): RegistryDraft => ({
			mode: s.mode === 'external' ? 'external' : 'platform',
			endpoint: s.mode === 'external' ? (s.endpoint ?? '') : '',
			insecure: s.mode === 'external' ? s.insecure : false,
			username: s.mode === 'external' ? (s.username ?? '') : '',
			password: ''
		}),
		toPayload: (draft): SaveRegistryInput =>
			draft.mode === 'platform'
				? { mode: 'platform' }
				: {
						mode: 'external',
						endpoint: draft.endpoint.trim(),
						insecure: draft.insecure,
						username: draft.username.trim(),
						...(draft.password ? { password: draft.password } : {})
					},
		isDirty: (draft, s) => {
			if (draft.mode !== (s.mode === 'external' ? 'external' : 'platform')) return true;
			if (draft.mode === 'platform') return false;
			return (
				draft.endpoint.trim() !== (s.endpoint ?? '') ||
				draft.insecure !== s.insecure ||
				draft.username.trim() !== (s.username ?? '') ||
				draft.password.length > 0
			);
		},
		validate: draft => registryEndpointOk(draft) && registryUsernameOk(draft) && registryPasswordOk(draft, registryHasPassword.value),
		afterSave: draft => {
			draft.password = '';
		}
	});

	const draft = reactive({
		domain: domainGroup.draft,
		smtp: smtpGroup.draft,
		metrics: metricsGroup.draft,
		registry: registryGroup.draft
	});

	// Derived read-only state the cards surface.
	const sslipBase = computed(() => (domain.settings.value?.mode === 'sslip' ? domain.settings.value.effectiveBase : null));
	const smtpHasPassword = computed(() => smtp.settings.value?.hasPassword ?? false);
	const smtpUsingDefaults = computed(() => smtp.settings.value?.source === 'env-default');
	const registryApplyStatus = computed(() => registry.settings.value?.applyStatus ?? 'not_configured');
	const registryActiveRunId = computed(() => registry.settings.value?.activeRunId ?? null);
	const registryLastError = computed(() => registry.settings.value?.lastError ?? null);

	// Per-field validity flags the cards render inline — same predicates the groups gate saves on.
	const domainBaseValid = computed(() => domainBaseOk(draft.domain));
	const smtpHostValid = computed(() => smtpHostOk(draft.smtp));
	const smtpPortValid = computed(() => smtpPortOk(draft.smtp));
	const smtpFromNameValid = computed(() => smtpFromNameOk(draft.smtp));
	const smtpFromAddressValid = computed(() => smtpFromAddressOk(draft.smtp));
	const metricsUrlValid = computed(() => metricsUrlOk(draft.metrics));
	const registryEndpointValid = computed(() => registryEndpointOk(draft.registry));
	const registryUsernameValid = computed(() => registryUsernameOk(draft.registry));
	const registryPasswordValid = computed(() => registryPasswordOk(draft.registry, registryHasPassword.value));

	const composed = composeSettingsGroups([domainGroup, registryGroup, smtpGroup, metricsGroup]);

	// Test email is an action, not a setting.
	const testPending = computed(() => smtp.sendTest.isPending.value);
	function runTest(to: string) {
		smtp.sendTest.mutate(to);
	}

	return reactive({
		draft,
		sslipBase,
		smtpHasPassword,
		smtpUsingDefaults,
		registryHasPassword,
		registryApplyStatus,
		registryActiveRunId,
		registryLastError,
		domainBaseValid,
		smtpHostValid,
		smtpPortValid,
		smtpFromNameValid,
		smtpFromAddressValid,
		metricsUrlValid,
		registryEndpointValid,
		registryUsernameValid,
		registryPasswordValid,
		isDirty: composed.isDirty,
		dirtyCount: composed.dirtyCount,
		isSaving: composed.isSaving,
		canSave: composed.canSave,
		save: composed.save,
		discard: composed.discard,
		testPending,
		runTest
	});
}

export type IntegrationSettingsStore = ReturnType<typeof createIntegrationSettingsStore>;

const INTEGRATION_SETTINGS_KEY: InjectionKey<IntegrationSettingsStore> = Symbol('integration-settings');

/** Create the store and provide it to descendants. Call once, in the container. */
export function provideIntegrationSettings(): IntegrationSettingsStore {
	const store = createIntegrationSettingsStore();
	provide(INTEGRATION_SETTINGS_KEY, store);
	return store;
}

/** Inject the store inside the integration section cards. */
export function useIntegrationSettings(): IntegrationSettingsStore {
	const store = inject(INTEGRATION_SETTINGS_KEY);
	if (!store) throw new Error('useIntegrationSettings() must be used within <AdminIntegrationsSettings>');
	return store;
}
