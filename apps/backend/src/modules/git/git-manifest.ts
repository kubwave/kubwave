export interface GithubManifest {
	name: string;
	url: string;
	// Omitted when the base URL isn't publicly reachable — GitHub rejects a manifest whose hook URL it can't reach (e.g. console.localhost).
	hook_attributes?: { url: string; active: boolean };
	redirect_url: string;
	callback_urls: string[];
	setup_url: string;
	public: boolean;
	default_permissions: Record<string, string>;
	default_events?: string[];
}

const CALLBACK_PATH = '/api/git/github/callback';
const WEBHOOK_PATH = '/api/git/github/webhook';
const SETTINGS_PATH = '/admin/settings';
const SETUP_PATH = '/team/settings';

function base(appBaseUrl: string): string {
	return appBaseUrl.replace(/\/+$/, '');
}

export function githubCallbackUrl(appBaseUrl: string): string {
	return `${base(appBaseUrl)}${CALLBACK_PATH}`;
}

export function githubWebhookUrl(appBaseUrl: string): string {
	return `${base(appBaseUrl)}${WEBHOOK_PATH}`;
}

export function consoleGitSettingsUrl(appBaseUrl: string, query?: Record<string, string>): string {
	const q = query ? `?${new URLSearchParams(query).toString()}` : '';
	return `${base(appBaseUrl)}${SETTINGS_PATH}${q}`;
}

// Post-install landing: a team-accessible page (installing is a team-owner action), where GitHub appends installation_id + setup_action.
export function githubSetupUrl(appBaseUrl: string): string {
	return `${base(appBaseUrl)}${SETUP_PATH}?tab=github`;
}

// GitHub App names must be globally unique and ≤34 chars (alphanumeric/hyphen); derive a stable suffix from the host so two kubwave instances don't collide.
export function defaultAppName(appBaseUrl: string): string {
	let host = appBaseUrl;
	try {
		host = new URL(appBaseUrl).host;
	} catch {
		/* fall back to the raw string */
	}
	const slug = host
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();
	return `kubwave-${slug}`.slice(0, 34).replace(/-+$/g, '');
}

// GitHub can only deliver webhooks to a public host; localhost/loopback/private/non-FQDN hosts get an App with no hook (deploys still work via polling).
export function isPubliclyReachable(appBaseUrl: string): boolean {
	let host: string;
	try {
		host = new URL(appBaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
	} catch {
		return false;
	}
	if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1') return false;
	if (!host.includes('.') && !host.includes(':')) return false;
	if (host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
	return true;
}

export function buildAppManifest(appBaseUrl: string, opts?: { name?: string }): GithubManifest {
	const reachable = isPubliclyReachable(appBaseUrl);
	return {
		name: opts?.name?.trim() || defaultAppName(appBaseUrl),
		url: base(appBaseUrl),
		redirect_url: githubCallbackUrl(appBaseUrl),
		callback_urls: [githubCallbackUrl(appBaseUrl)],
		setup_url: githubSetupUrl(appBaseUrl),
		public: false,
		default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'write', statuses: 'write' },
		// Events need a hook; both are omitted together when GitHub couldn't reach the webhook anyway.
		...(reachable ? { hook_attributes: { url: githubWebhookUrl(appBaseUrl), active: true }, default_events: ['push', 'pull_request'] } : {})
	};
}

// GitHub's App-creation endpoint; the org variant when an org login is given, else the admin's personal account.
export function appsNewUrl(state: string, organization?: string): string {
	const q = `state=${encodeURIComponent(state)}`;
	return organization
		? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new?${q}`
		: `https://github.com/settings/apps/new?${q}`;
}

export function installUrl(slug: string): string {
	return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}

export interface ManifestConversion {
	appId: string;
	slug: string;
	clientId: string | null;
	clientSecret: string | null;
	pem: string;
	webhookSecret: string;
}

// Pull the fields we persist out of GitHub's manifest-conversion response; throws if any required field is absent so a partial response is never stored.
// webhook_secret is absent when the App was created without a hook (non-public base URL) — then it's stored empty; no deliveries arrive to verify anyway.
export function parseManifestConversion(json: unknown): ManifestConversion {
	const o = (json ?? {}) as Record<string, unknown>;
	const appId = o.id;
	if (typeof appId !== 'number' && typeof appId !== 'string') throw new Error('manifest conversion missing app id');
	if (typeof o.slug !== 'string' || !o.slug) throw new Error('manifest conversion missing slug');
	if (typeof o.pem !== 'string' || !o.pem) throw new Error('manifest conversion missing private key (pem)');
	return {
		appId: String(appId),
		slug: o.slug,
		clientId: typeof o.client_id === 'string' ? o.client_id : null,
		clientSecret: typeof o.client_secret === 'string' ? o.client_secret : null,
		pem: o.pem,
		webhookSecret: typeof o.webhook_secret === 'string' ? o.webhook_secret : ''
	};
}
