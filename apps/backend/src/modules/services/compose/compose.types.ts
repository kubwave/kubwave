import type { DockerImageServiceConfig } from '@kubwave/db';

export interface ParsedComposeService {
	name: string;
	config: DockerImageServiceConfig;
}
