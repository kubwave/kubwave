import type { ServiceViewDto } from '../generated/types.gen.js';

export type ServiceType =
	| 'docker-image'
	| 'dockerfile'
	| 'public-repo'
	| 'private-repo'
	| 'github-repo'
	| 'postgres'
	| 'mysql'
	| 'mariadb'
	| 'mongodb';

export interface EnvVar {
	key: string;
	value: string;
}

export interface SecretInput {
	key: string;
	value: string | null;
}

export interface SecretView {
	key: string;
	hasValue: boolean;
}

export interface ServiceDomain {
	host: string;
	port: number;
}

export interface ServicePortExposure {
	containerPort: number;
	publicPort: number;
}

export interface ResourceConfig {
	cpuRequest?: string;
	cpuLimit?: string;
	memoryRequest?: string;
	memoryLimit?: string;
}

export interface ServiceVolume {
	name: string;
	mountPath: string;
	size: string;
	subPath?: string;
}

export interface AutoscalingConfig {
	enabled: boolean;
	minReplicas?: number;
	maxReplicas?: number;
	targetCpuUtilizationPercentage?: number;
	targetMemoryUtilizationPercentage?: number;
}

export interface HealthCheckConfig {
	enabled: boolean;
	type: 'http' | 'tcp';
	path?: string;
	port?: number;
	initialDelaySeconds?: number;
	periodSeconds?: number;
	timeoutSeconds?: number;
	failureThreshold?: number;
	successThreshold?: number;
}

export interface RuntimeConfig<TSecret> {
	containerPort: number | null;
	defaultDomainEnabled?: boolean;
	env: Array<EnvVar>;
	secrets: Array<TSecret>;
	domains: Array<ServiceDomain>;
	exposedPorts?: Array<ServicePortExposure>;
	volumes: Array<ServiceVolume>;
	healthCheck?: HealthCheckConfig;
	resources?: ResourceConfig;
	autoscaling?: AutoscalingConfig;
}

export interface RegistryAuthView {
	enabled: boolean;
	server: string;
	username: string;
	hasPassword: boolean;
}

export interface RegistryAuthInput {
	enabled: boolean;
	server: string;
	username: string;
	// null = keep the stored password.
	password: string | null;
}

export interface DockerImageServiceConfig<TSecret = SecretView> extends RuntimeConfig<TSecret> {
	image: string;
	tag: string;
	registryAuth?: RegistryAuthView;
}

export interface DockerfileServiceConfig<TSecret = SecretView> extends RuntimeConfig<TSecret> {
	dockerfile: string;
}

export interface PublicRepoServiceConfig<TSecret = SecretView> extends RuntimeConfig<TSecret> {
	repoUrl: string;
	branch: string;
	commit?: string;
	rootDirectory?: string;
	watchPaths?: string[];
	watchEntireRepo?: boolean;
	buildCommand?: string;
	startCommand?: string;
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath?: string;
}

export interface PrivateRepoServiceConfig<TSecret = SecretView> extends PublicRepoServiceConfig<TSecret> {
	repoUrl: string;
	sshKeyId: string;
}

export interface GithubRepoServiceConfig<TSecret = SecretView> extends PublicRepoServiceConfig<TSecret> {
	repoFullName: string;
	installationId: string;
}

export interface DatabaseServiceConfig<TSecret = SecretView> extends RuntimeConfig<TSecret> {
	version: string;
	storage: {
		size: string;
	};
	database?: string;
	username?: string;
}

export type ServiceConfigView =
	| DockerImageServiceConfig<SecretView>
	| DockerfileServiceConfig<SecretView>
	| PublicRepoServiceConfig<SecretView>
	| PrivateRepoServiceConfig<SecretView>
	| GithubRepoServiceConfig<SecretView>
	| DatabaseServiceConfig<SecretView>;

export type ServiceConfigInput =
	| (Omit<DockerImageServiceConfig<SecretInput>, 'registryAuth'> & { registryAuth?: RegistryAuthInput })
	| DockerfileServiceConfig<SecretInput>
	| PublicRepoServiceConfig<SecretInput>
	| PrivateRepoServiceConfig<SecretInput>
	| GithubRepoServiceConfig<SecretInput>
	| DatabaseServiceConfig<SecretInput>;

export type ServiceView = Omit<ServiceViewDto, 'config'> & {
	config: ServiceConfigView;
};
