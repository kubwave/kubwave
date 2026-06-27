// Managed-database engine catalog: pure, dependency-free single source of truth shared by API, console, and worker.

import type { DatabaseEngine, DatabaseServiceConfig, RuntimeConfig } from './schema';

export const DATABASE_ENGINES: readonly DatabaseEngine[] = ['postgres', 'mysql', 'mariadb', 'mongodb'];

// The single data volume every managed database mounts; derived from config.storage.size, not stored as a volumes[] entry.
export const DATABASE_VOLUME_NAME = 'data';

// Defaults applied when the user leaves them blank at create time.
export const DEFAULT_DATABASE_USERNAME = 'app';
export const DEFAULT_DATABASE_NAME = 'app';

export interface DatabaseEngineSpec {
	displayName: string;
	// Docker Hub image (public). Combined with the chosen version as `<image>:<version>`.
	image: string;
	// In-cluster port the engine listens on (also the service's containerPort).
	port: number;
	// Where the engine persists data; the PVC mounts here.
	dataDir: string;
	// Plaintext init env: which key carries the app user / the initial database name.
	userEnvKey: string;
	databaseEnvKey: string;
	// Secret init env: every key receives the one generated password (MySQL/MariaDB need both root and app-user, hence a list).
	passwordEnvKeys: string[];
	// Extra fixed plaintext env (e.g. Postgres PGDATA to avoid the lost+found init clash).
	extraEnv: Array<{ key: string; value: string }>;
	// Connection URI scheme (no `://`) and optional query (e.g. Mongo's auth source).
	uriScheme: string;
	uriQuery: string;
	// Curated major versions, newest first; `default` is preselected in the create form.
	versions: { allowed: string[]; default: string };
}

export const DATABASE_ENGINE_CATALOG: Record<DatabaseEngine, DatabaseEngineSpec> = {
	postgres: {
		displayName: 'PostgreSQL',
		image: 'postgres',
		port: 5432,
		dataDir: '/var/lib/postgresql/data',
		userEnvKey: 'POSTGRES_USER',
		databaseEnvKey: 'POSTGRES_DB',
		passwordEnvKeys: ['POSTGRES_PASSWORD'],
		// Postgres won't init into a dir containing lost+found, so PGDATA points at a subdir, not the mount root.
		extraEnv: [{ key: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' }],
		uriScheme: 'postgresql',
		uriQuery: '',
		versions: { allowed: ['17', '16', '15'], default: '16' }
	},
	mysql: {
		displayName: 'MySQL',
		image: 'mysql',
		port: 3306,
		dataDir: '/var/lib/mysql',
		userEnvKey: 'MYSQL_USER',
		databaseEnvKey: 'MYSQL_DATABASE',
		passwordEnvKeys: ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD'],
		extraEnv: [],
		uriScheme: 'mysql',
		uriQuery: '',
		versions: { allowed: ['8.4', '8.0'], default: '8.4' }
	},
	mariadb: {
		displayName: 'MariaDB',
		image: 'mariadb',
		port: 3306,
		dataDir: '/var/lib/mysql',
		userEnvKey: 'MARIADB_USER',
		databaseEnvKey: 'MARIADB_DATABASE',
		passwordEnvKeys: ['MARIADB_ROOT_PASSWORD', 'MARIADB_PASSWORD'],
		extraEnv: [],
		uriScheme: 'mysql',
		uriQuery: '',
		versions: { allowed: ['11.4', '10.11'], default: '11.4' }
	},
	mongodb: {
		displayName: 'MongoDB',
		image: 'mongo',
		port: 27017,
		dataDir: '/data/db',
		userEnvKey: 'MONGO_INITDB_ROOT_USERNAME',
		databaseEnvKey: 'MONGO_INITDB_DATABASE',
		passwordEnvKeys: ['MONGO_INITDB_ROOT_PASSWORD'],
		extraEnv: [],
		uriScheme: 'mongodb',
		// The root user is created in the admin database, so clients must authenticate against it.
		uriQuery: '?authSource=admin',
		versions: { allowed: ['8', '7'], default: '7' }
	}
};

export function isDatabaseEngine(type: string): type is DatabaseEngine {
	return (DATABASE_ENGINES as readonly string[]).includes(type);
}

export function defaultDatabaseVersion(engine: DatabaseEngine): string {
	return DATABASE_ENGINE_CATALOG[engine].versions.default;
}

export function isAllowedDatabaseVersion(engine: DatabaseEngine, version: string): boolean {
	return DATABASE_ENGINE_CATALOG[engine].versions.allowed.includes(version);
}

export function databaseImageRef(engine: DatabaseEngine, version: string): string {
	return `${DATABASE_ENGINE_CATALOG[engine].image}:${version}`;
}

// Connection URI for a consumer service; username/password are URL-encoded so special characters survive.
export function databaseConnectionUri(input: {
	engine: DatabaseEngine;
	host: string;
	port: number;
	username: string;
	password: string;
	database: string;
}): string {
	const spec = DATABASE_ENGINE_CATALOG[input.engine];
	const user = encodeURIComponent(input.username);
	const pass = encodeURIComponent(input.password);
	return `${spec.uriScheme}://${user}:${pass}@${input.host}:${input.port}/${input.database}${spec.uriQuery}`;
}

// Synthesize runtime config from the stored DB config + engine spec; password re-keyed under every engine key, user env/secrets appended verbatim.
export function buildDatabaseRuntimeConfig(engine: DatabaseEngine, config: DatabaseServiceConfig): RuntimeConfig {
	const spec = DATABASE_ENGINE_CATALOG[engine];
	const username = config.username?.trim() || DEFAULT_DATABASE_USERNAME;
	const database = config.database?.trim() || DEFAULT_DATABASE_NAME;
	const passwordSecrets = config.password ? spec.passwordEnvKeys.map(key => ({ key, value: config.password })) : [];
	return {
		containerPort: spec.port,
		env: [{ key: spec.userEnvKey, value: username }, { key: spec.databaseEnvKey, value: database }, ...spec.extraEnv, ...config.env],
		secrets: [...passwordSecrets, ...(config.secrets ?? [])],
		domains: [],
		volumes: [{ name: DATABASE_VOLUME_NAME, mountPath: spec.dataDir, size: config.storage.size }],
		healthCheck: { enabled: true, type: 'tcp', port: spec.port },
		resources: config.resources
	};
}
