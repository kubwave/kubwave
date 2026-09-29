import type { ServiceType, ServiceView } from '@kubwave/api-client';

// UI mirror of the managed-database engines; packages/db/src/database-engines.ts is the source of truth.
export const DATABASE_ENGINES = ['postgres', 'mysql', 'mariadb', 'mongodb'] as const;
export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export const DATABASE_ENGINE_UI: Record<
	DatabaseEngine,
	{ label: string; description: string; versions: string[]; defaultVersion: string; dataDir: string }
> = {
	postgres: {
		label: 'PostgreSQL',
		description: 'Relational database.',
		versions: ['17', '16', '15'],
		defaultVersion: '16',
		dataDir: '/var/lib/postgresql/data'
	},
	mysql: { label: 'MySQL', description: 'Relational database.', versions: ['8.4', '8.0'], defaultVersion: '8.4', dataDir: '/var/lib/mysql' },
	mariadb: {
		label: 'MariaDB',
		description: 'MySQL-compatible database.',
		versions: ['11.4', '10.11'],
		defaultVersion: '11.4',
		dataDir: '/var/lib/mysql'
	},
	mongodb: { label: 'MongoDB', description: 'Document database.', versions: ['8', '7'], defaultVersion: '7', dataDir: '/data/db' }
};

export function isDatabaseEngine(type: string): type is DatabaseEngine {
	return (DATABASE_ENGINES as readonly string[]).includes(type);
}

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
	'docker-image': 'Docker',
	dockerfile: 'Dockerfile',
	'public-repo': 'Git',
	'private-repo': 'Git (SSH)',
	'github-repo': 'GitHub',
	'gitea-repo': 'Gitea',
	postgres: 'PostgreSQL',
	mysql: 'MySQL',
	mariadb: 'MariaDB',
	mongodb: 'MongoDB'
};

type SourceInput = Pick<ServiceView, 'type' | 'config'>;

const shortRepoUrl = (url: string) =>
	url
		.replace(/^\w+:\/\//, '')
		.replace(/^git@([^:]+):/, '$1/')
		.replace(/\.git$/, '');

// One line describing what a service runs: image, repository (+ branch), engine, or Dockerfile.
export function serviceSource({ type, config }: SourceInput): { label: string; branch?: string } {
	if (isDatabaseEngine(type) && 'version' in config) return { label: `${DATABASE_ENGINE_UI[type].label} ${config.version}` };
	if ('image' in config) return { label: `${config.image}:${config.tag}` };
	if ('repoUrl' in config) {
		const label = 'repoFullName' in config && config.repoFullName ? config.repoFullName : shortRepoUrl(config.repoUrl);
		return config.branch ? { label, branch: config.branch } : { label };
	}
	return { label: 'Built from Dockerfile' };
}

// Name of a managed database's data volume (packages/db DATABASE_VOLUME_NAME); metrics report usage under it.
const DATABASE_VOLUME_NAME = 'data';

// The volume a service card shows: a managed database's data volume, else the first mounted volume.
export function serviceVolume({ type, config }: SourceInput): { name: string; mountPath: string; size: string } | null {
	if (isDatabaseEngine(type) && 'storage' in config)
		return { name: DATABASE_VOLUME_NAME, mountPath: DATABASE_ENGINE_UI[type].dataDir, size: config.storage.size };
	const volume = config.volumes?.[0];
	return volume ? { name: volume.name, mountPath: volume.mountPath, size: volume.size } : null;
}

// The public host shown on a service: its first custom domain, else the platform default URL.
export function serviceDomain(service: Pick<ServiceView, 'config' | 'defaultUrl'>): string | null {
	const custom = service.config.domains?.[0]?.host;
	if (custom) return custom;
	if (!service.defaultUrl || !URL.canParse(service.defaultUrl)) return null;
	return new URL(service.defaultUrl).host;
}
