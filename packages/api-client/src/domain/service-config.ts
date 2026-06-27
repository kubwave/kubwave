import type { ServiceViewDto } from '../generated/types.gen.js';

export type ServiceType = 'docker-image' | 'dockerfile' | 'public-repo' | 'private-repo' | 'postgres' | 'mysql' | 'mariadb' | 'mongodb';

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
	volumes: Array<ServiceVolume>;
	healthCheck?: HealthCheckConfig;
	resources?: ResourceConfig;
	autoscaling?: AutoscalingConfig;
}

export interface DockerImageServiceConfig<TSecret = SecretView> extends RuntimeConfig<TSecret> {
	image: string;
	tag: string;
}

export interface DockerfileServiceConfig<TSecret = SecretView> extends RuntimeConfig<TSecret> {
	dockerfile: string;
}

export interface PublicRepoServiceConfig<TSecret = SecretView> extends RuntimeConfig<TSecret> {
	repoUrl: string;
	branch: string;
	commit?: string;
	rootDirectory?: string;
	buildCommand?: string;
	startCommand?: string;
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath?: string;
}

export interface PrivateRepoServiceConfig<TSecret = SecretView> extends PublicRepoServiceConfig<TSecret> {
	repoUrl: string;
	sshKeyId: string;
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
	| DatabaseServiceConfig<SecretView>;

export type ServiceConfigInput =
	| DockerImageServiceConfig<SecretInput>
	| DockerfileServiceConfig<SecretInput>
	| PublicRepoServiceConfig<SecretInput>
	| PrivateRepoServiceConfig<SecretInput>
	| DatabaseServiceConfig<SecretInput>;

export type ServiceView = Omit<ServiceViewDto, 'config'> & {
	config: ServiceConfigView;
};
