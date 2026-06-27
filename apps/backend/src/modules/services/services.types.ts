import type {
	DatabaseServiceConfig,
	DefaultDomainRuntime,
	DefaultDomainSettings,
	DockerfileServiceConfig,
	DockerImageServiceConfig,
	PrivateRepoServiceConfig,
	PublicRepoServiceConfig,
	ServiceConfig,
	ServiceType
} from '@kubwave/db';

type SecretsView = Array<{ key: string; hasValue: boolean }>;

// Config-file content is decrypted in toConfigView, so the view keeps `configFiles` (unlike `secrets`).
export type DockerImageConfigView = Omit<DockerImageServiceConfig, 'secrets'> & { secrets: SecretsView };
export type DockerfileConfigView = Omit<DockerfileServiceConfig, 'secrets'> & { secrets: SecretsView };
export type PublicRepoConfigView = Omit<PublicRepoServiceConfig, 'secrets'> & { secrets: SecretsView };
export type PrivateRepoConfigView = Omit<PrivateRepoServiceConfig, 'secrets'> & { secrets: SecretsView };
export type DatabaseConfigView = Omit<DatabaseServiceConfig, 'secrets' | 'password'> & { secrets: SecretsView };
export type ServiceConfigView = DockerImageConfigView | DockerfileConfigView | PublicRepoConfigView | PrivateRepoConfigView | DatabaseConfigView;

export interface ServiceConnectionView {
	engine: ServiceType;
	host: string;
	port: number;
	username: string;
	database: string;
	password: string;
	uri: string;
}

export interface AutoDeployView {
	enabled: boolean;
	lastPolledCommit: string | null;
	lastPolledAt: string | null;
	nextPollAt: string | null;
	lastPollError: string | null;
}

export interface ServiceView {
	id: string;
	environmentId: string;
	name: string;
	description: string;
	type: ServiceType;
	config: ServiceConfigView;
	autoDeploy: AutoDeployView;
	internalDomain: string | null;
	defaultUrl: string | null;
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
	createdAt: Date;
	updatedAt: Date;
}

export interface DefaultDomainContext {
	settings: DefaultDomainSettings;
	runtime: DefaultDomainRuntime;
}
