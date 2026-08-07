import type {
	DatabaseServiceConfig,
	DefaultDomainRuntime,
	DefaultDomainSettings,
	DockerfileServiceConfig,
	DockerImageServiceConfig,
	GithubRepoServiceConfig,
	PrivateRepoServiceConfig,
	PublicRepoServiceConfig,
	ServiceConfig,
	ServiceType
} from '@kubwave/db';

type SecretsView = Array<{ key: string; hasValue: boolean }>;

export interface BasicAuthView {
	enabled: boolean;
	username: string;
	hasPassword: boolean;
}

export interface RegistryAuthView {
	enabled: boolean;
	server: string;
	username: string;
	hasPassword: boolean;
}

type SensitiveRuntime = 'secrets' | 'basicAuth';

// Config-file content is decrypted in toConfigView, so the view keeps `configFiles` (unlike `secrets`).
export type DockerImageConfigView = Omit<DockerImageServiceConfig, SensitiveRuntime | 'registryAuth'> & {
	secrets: SecretsView;
	basicAuth?: BasicAuthView;
	registryAuth?: RegistryAuthView;
};
export type DockerfileConfigView = Omit<DockerfileServiceConfig, SensitiveRuntime> & { secrets: SecretsView; basicAuth?: BasicAuthView };
export type PublicRepoConfigView = Omit<PublicRepoServiceConfig, SensitiveRuntime> & { secrets: SecretsView; basicAuth?: BasicAuthView };
export type PrivateRepoConfigView = Omit<PrivateRepoServiceConfig, SensitiveRuntime> & { secrets: SecretsView; basicAuth?: BasicAuthView };
export type GithubRepoConfigView = Omit<GithubRepoServiceConfig, SensitiveRuntime> & { secrets: SecretsView; basicAuth?: BasicAuthView };
export type DatabaseConfigView = Omit<DatabaseServiceConfig, SensitiveRuntime | 'password'> & { secrets: SecretsView; basicAuth?: BasicAuthView };
export type ServiceConfigView =
	| DockerImageConfigView
	| DockerfileConfigView
	| PublicRepoConfigView
	| PrivateRepoConfigView
	| GithubRepoConfigView
	| DatabaseConfigView;

export interface ServiceConnectionView {
	engine: ServiceType;
	host: string;
	port: number;
	username: string;
	database: string;
	password: string;
	uri: string;
	// Public reachability via a TCP exposure on the engine port; null when not exposed or the ingress IP is unknown.
	externalHost: string | null;
	externalPort: number | null;
	externalUri: string | null;
}

export interface AutoDeployView {
	enabled: boolean;
	lastPolledCommit: string | null;
	lastPolledAt: string | null;
	nextPollAt: string | null;
	lastPollError: string | null;
}

export interface ImageWatchView {
	enabled: boolean;
	lastDigest: string | null;
	lastCheckedAt: string | null;
	nextCheckAt: string | null;
	lastError: string | null;
}

export interface ExposedEndpointView {
	containerPort: number;
	publicPort: number;
	// Public ingress IP to connect to; null when the platform hasn't resolved one yet.
	host: string | null;
}

export interface ServiceView {
	id: string;
	environmentId: string;
	name: string;
	description: string;
	type: ServiceType;
	config: ServiceConfigView;
	autoDeploy: AutoDeployView;
	imageWatch: ImageWatchView;
	internalDomain: string | null;
	defaultUrl: string | null;
	exposedEndpoints: ExposedEndpointView[];
	createdAt: string;
	updatedAt: string;
}

export interface ServiceRow {
	id: string;
	environmentId: string;
	name: string;
	description: string;
	type: ServiceType;
	config: ServiceConfig;
	autoDeployEnabled: boolean;
	lastPolledCommit: string | null;
	lastPolledAt: Date | null;
	nextPollAt: Date | null;
	lastPollError: string | null;
	imageWatchEnabled: boolean;
	lastWatchedDigest: string | null;
	lastWatchedAt: Date | null;
	nextWatchAt: Date | null;
	lastWatchError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface DefaultDomainContext {
	settings: DefaultDomainSettings;
	runtime: DefaultDomainRuntime;
}
