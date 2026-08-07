import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
	boolean,
	check,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	password: text('password').notNull(),
	isAdmin: boolean('is_admin').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const teamRole = pgEnum('team_role', ['owner', 'member']);

export const teams = pgTable(
	'teams',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		defaultForUserId: uuid('default_for_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [uniqueIndex('teams_default_for_user_id_unique').on(table.defaultForUserId)]
);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type ServiceType = 'docker-image' | 'dockerfile' | 'public-repo' | 'private-repo' | 'github-repo' | DatabaseEngine;

// Single-instance managed-database engines; each is its own service type but shares one config shape (DatabaseServiceConfig) and one worker deployer.
export type DatabaseEngine = 'postgres' | 'mysql' | 'mariadb' | 'mongodb';

export interface ServiceDomain {
	host: string;
	port: number;
}

// A TCP container port reachable on the platform's public ingress IP; publicPort is allocated server-side from the configured pool.
export interface ServicePortExposure {
	containerPort: number;
	publicPort: number;
}

export interface ServiceVolume {
	name: string;
	mountPath: string;
	size: string;
	// Mount a subdirectory at mountPath instead of the volume root, so images that initdb into the root avoid the lost+found ext4 PVs place there.
	subPath?: string;
}

// A file mounted at `path`, rendered at instantiation; `content` is ciphertext the worker decrypts into a K8s Secret volume.
export interface ServiceConfigFile {
	path: string;
	content: string;
}

export interface ResourceConfig {
	cpuRequest?: string;
	cpuLimit?: string;
	memoryRequest?: string;
	memoryLimit?: string;
}

export interface AutoscalingConfig {
	enabled: boolean;
	minReplicas?: number;
	maxReplicas?: number;
	targetCpuUtilizationPercentage?: number;
	targetMemoryUtilizationPercentage?: number;
}

export interface BasicAuthConfig {
	username: string;
	// Ciphertext (AES-256-GCM); worker decrypts into an htpasswd Secret for the ingress controller.
	password: string;
}

// Credentials for pulling a service's image from a private registry; the worker renders them into a per-service dockerconfigjson Secret.
export interface RegistryAuthConfig {
	server: string;
	username: string;
	// Ciphertext (AES-256-GCM); worker decrypts when building the pull Secret, API returns only hasPassword.
	password: string;
}

export interface RuntimeConfig {
	containerPort: number | null;
	// Only true enables the platform-generated public default domain. Absent/false stays internal-only.
	defaultDomainEnabled?: boolean;
	env: Array<{ key: string; value: string }>;
	// Sensitive env vars as ciphertext; worker decrypts into a K8s Secret, API returns only per-key hasValue. Absent on pre-secrets rows — treat as [].
	secrets?: Array<{ key: string; value: string }>;
	domains: ServiceDomain[];
	volumes: ServiceVolume[];
	// Config files rendered at instantiation and mounted into the container; content is ciphertext. Absent on rows without files — treat as [].
	configFiles?: ServiceConfigFile[];
	// TCP ports exposed publicly via the ingress controller's TCP entrypoints. Absent on pre-feature rows — treat as [].
	exposedPorts?: ServicePortExposure[];
	// Container entrypoint/command override (maps to k8s container.command/args). Optional.
	command?: string[];
	args?: string[];
	healthCheck?: HealthCheckConfig;
	resources?: ResourceConfig;
	autoscaling?: AutoscalingConfig;
	// HTTP basic auth enforced at the ingress (Traefik Middleware). Absent = disabled.
	basicAuth?: BasicAuthConfig;
}

export interface DockerImageServiceConfig extends RuntimeConfig {
	image: string;
	tag: string;
	// Optional private-registry login for this image. Absent = anonymous pull (or the platform pull secret).
	registryAuth?: RegistryAuthConfig;
	// Digest pinned into a deployment snapshot when tag-watch enqueues; the service row stays unset so the tag keeps being tracked.
	digest?: string;
}

export interface DockerfileServiceConfig extends RuntimeConfig {
	dockerfile: string;
}

export interface PublicRepoServiceConfig extends RuntimeConfig {
	repoUrl: string;
	branch: string;
	commit?: string;
	rootDirectory?: string;
	// Extra repo-relative prefixes that also trigger auto-deploy (shared packages). Used with rootDirectory unless watchEntireRepo.
	watchPaths?: string[];
	// When true, auto-deploy ignores rootDirectory/watchPaths and reacts to any commit on the branch.
	watchEntireRepo?: boolean;
	buildCommand?: string;
	startCommand?: string;
	// 'nixpacks' (default) auto-generates a Dockerfile from the source; 'dockerfile' uses the repo's own. buildCommand/startCommand apply to nixpacks only.
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath?: string;
}

export interface PrivateRepoServiceConfig extends RuntimeConfig {
	repoUrl: string;
	branch: string;
	commit?: string;
	rootDirectory?: string;
	watchPaths?: string[];
	watchEntireRepo?: boolean;
	buildCommand?: string;
	startCommand?: string;
	// FK → ssh_keys.id (scope='team'). The API validates it belongs to the service's team.
	sshKeyId: string;
	// Same meaning as on PublicRepoServiceConfig: nixpacks (default) vs. the repo's own Dockerfile.
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath?: string;
}

// Same shape as PublicRepoServiceConfig but authenticated via a GitHub App installation instead of a deploy key; clone/poll mint a short-lived token from it.
export interface GithubRepoServiceConfig extends RuntimeConfig {
	repoUrl: string;
	branch: string;
	commit?: string;
	rootDirectory?: string;
	watchPaths?: string[];
	watchEntireRepo?: boolean;
	buildCommand?: string;
	startCommand?: string;
	// FK → git_installations.id. The API validates it belongs to the service's team.
	installationId: string;
	// owner/repo, cached so webhook routing and clone-URL derivation don't re-parse repoUrl.
	repoFullName: string;
	builder: 'nixpacks' | 'dockerfile';
	dockerfilePath?: string;
}

// Single-instance managed database; reuses RuntimeConfig but the worker derives image/port/init-env/volume/probe from the engine catalog.
export interface DatabaseServiceConfig extends RuntimeConfig {
	version: string; // engine major, validated against the engine catalog (e.g. "16", "8.4")
	storage: { size: string }; // backing PVC size, expand-only (e.g. "1Gi")
	database?: string; // initial database name; defaults to "app"
	username?: string; // application user; defaults to "app"
	// Generated DB password ciphertext, kept out of secrets[]; the worker re-keys it onto every engine password env, returned only via the connection endpoint.
	password: string;
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

// Discriminated by the sibling `type` column. Readers narrow via service.type / deployment.type.
export type ServiceConfig =
	| DockerImageServiceConfig
	| DockerfileServiceConfig
	| PublicRepoServiceConfig
	| PrivateRepoServiceConfig
	| GithubRepoServiceConfig
	| DatabaseServiceConfig;

export const teamMembers = pgTable(
	'team_members',
	{
		teamId: uuid('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: teamRole('role').notNull().default('member'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [primaryKey({ columns: [table.teamId, table.userId] }), index('team_members_user_id_created_at_idx').on(table.userId, table.createdAt)]
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

export const sshKeyScope = pgEnum('ssh_key_scope', ['team', 'admin']);
export const sshKeyType = pgEnum('ssh_key_type', ['ed25519', 'rsa', 'ecdsa']);
export const sshKeySource = pgEnum('ssh_key_source', ['generated', 'uploaded']);

export const sshKeys = pgTable(
	'ssh_keys',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		scope: sshKeyScope('scope').notNull().default('team'),
		teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		keyType: sshKeyType('key_type').notNull(),
		source: sshKeySource('source').notNull(),
		// Comment-free OpenSSH public line ("ssh-ed25519 AAAA…"), safe to display.
		publicKey: text('public_key').notNull(),
		// encryptSecret(privateKey) — AES-256-GCM ciphertext, never returned to clients.
		privateKeyCiphertext: text('private_key_ciphertext').notNull(),
		// OpenSSH SHA256 fingerprint ("SHA256:…") for display/dedup.
		fingerprint: text('fingerprint').notNull(),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('ssh_keys_team_id_created_at_idx').on(table.teamId, table.createdAt),
		uniqueIndex('ssh_keys_team_id_name_unique').on(table.teamId, table.name),
		check(
			'ssh_keys_scope_team_id_ck',
			sql`(${table.scope} = 'team' AND ${table.teamId} IS NOT NULL) OR (${table.scope} = 'admin' AND ${table.teamId} IS NULL)`
		)
	]
);

export type SshKey = typeof sshKeys.$inferSelect;
export type NewSshKey = typeof sshKeys.$inferInsert;

export const gitProvider = pgEnum('git_provider', ['github']);

export const gitAppConnections = pgTable(
	'git_app_connections',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		provider: gitProvider('provider').notNull().default('github'),
		// GitHub App numeric id, as text; its URL slug is display-only.
		appId: text('app_id').notNull(),
		appSlug: text('app_slug').notNull(),
		// clientId isn't secret; the client secret and RSA private key are encryptSecret() ciphertext, never returned to clients.
		clientId: text('client_id'),
		clientSecretCiphertext: text('client_secret_ciphertext'),
		privateKeyCiphertext: text('private_key_ciphertext').notNull(),
		webhookSecretCiphertext: text('webhook_secret_ciphertext').notNull(),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [uniqueIndex('git_app_connections_provider_app_id_unique').on(table.provider, table.appId)]
);

export type GitAppConnection = typeof gitAppConnections.$inferSelect;
export type NewGitAppConnection = typeof gitAppConnections.$inferInsert;

export const gitInstallations = pgTable(
	'git_installations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		connectionId: uuid('connection_id')
			.notNull()
			.references(() => gitAppConnections.id, { onDelete: 'cascade' }),
		// GitHub numeric installation id, as text; used to mint installation tokens.
		githubInstallationId: text('github_installation_id').notNull(),
		accountLogin: text('account_login').notNull(),
		accountType: text('account_type').notNull(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		suspendedAt: timestamp('suspended_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		uniqueIndex('git_installations_connection_github_id_unique').on(table.connectionId, table.githubInstallationId),
		index('git_installations_team_id_idx').on(table.teamId)
	]
);

export type GitInstallation = typeof gitInstallations.$inferSelect;
export type NewGitInstallation = typeof gitInstallations.$inferInsert;

export const gitRepositories = pgTable(
	'git_repositories',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		installationId: uuid('installation_id')
			.notNull()
			.references(() => gitInstallations.id, { onDelete: 'cascade' }),
		repoFullName: text('repo_full_name').notNull(),
		defaultBranch: text('default_branch').notNull().default('main'),
		isPrivate: boolean('is_private').notNull().default(true),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [uniqueIndex('git_repositories_installation_full_name_unique').on(table.installationId, table.repoFullName)]
);

export type GitRepository = typeof gitRepositories.$inferSelect;
export type NewGitRepository = typeof gitRepositories.$inferInsert;

export const projects = pgTable(
	'projects',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('projects_team_id_created_at_idx').on(table.teamId, table.createdAt),
		uniqueIndex('projects_team_id_name_unique').on(table.teamId, table.name)
	]
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const environmentKind = pgEnum('environment_kind', ['persistent', 'preview']);
export type EnvironmentKind = (typeof environmentKind.enumValues)[number];

export const environments = pgTable(
	'environments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// 'persistent' (default) for user-created envs; 'preview' for worker-created PR clones.
		kind: environmentKind('kind').notNull().default('persistent'),
		prPreviewsEnabled: boolean('pr_previews_enabled').notNull().default(false),
		// Preview-env identity (set only when kind='preview').
		baseEnvironmentId: uuid('base_environment_id').references((): AnyPgColumn => environments.id, { onDelete: 'cascade' }),
		prNumber: integer('pr_number'),
		prRepoUrl: text('pr_repo_url'),
		prRef: text('pr_ref'),
		prNextPollAt: timestamp('pr_next_poll_at', { withTimezone: true }),
		prLastPolledAt: timestamp('pr_last_polled_at', { withTimezone: true }),
		prLastPollError: text('pr_last_poll_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('environments_project_id_created_at_idx').on(table.projectId, table.createdAt),
		uniqueIndex('environments_project_id_name_unique').on(table.projectId, table.name),
		// At most one preview per (base env, repo, PR); persistent envs have all three NULL, which Postgres treats as distinct so they never collide.
		uniqueIndex('environments_base_repo_pr_unique').on(table.baseEnvironmentId, table.prRepoUrl, table.prNumber),
		// Drives the pr-discovery sweep: find persistent envs with previews enabled that are due.
		index('environments_pr_previews_next_poll_idx').on(table.prPreviewsEnabled, table.prNextPollAt)
	]
);

export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;

export const serviceType = pgEnum('service_type', [
	'docker-image',
	'dockerfile',
	'public-repo',
	'private-repo',
	'github-repo',
	'postgres',
	'mysql',
	'mariadb',
	'mongodb'
]);

export const services = pgTable(
	'services',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		environmentId: uuid('environment_id')
			.notNull()
			.references(() => environments.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		type: serviceType('type').notNull(),
		config: jsonb('config').$type<ServiceConfig>().notNull(),
		autoDeployEnabled: boolean('auto_deploy_enabled').notNull().default(false),
		lastPolledCommit: text('last_polled_commit'),
		lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
		nextPollAt: timestamp('next_poll_at', { withTimezone: true }),
		lastPollError: text('last_poll_error'),
		// docker-image tag watch: mirrors the auto-deploy columns, tracking the last-seen registry digest instead of a commit.
		imageWatchEnabled: boolean('image_watch_enabled').notNull().default(false),
		lastWatchedDigest: text('last_watched_digest'),
		lastWatchedAt: timestamp('last_watched_at', { withTimezone: true }),
		nextWatchAt: timestamp('next_watch_at', { withTimezone: true }),
		lastWatchError: text('last_watch_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('services_environment_id_created_at_idx').on(table.environmentId, table.createdAt),
		uniqueIndex('services_environment_id_name_unique').on(table.environmentId, table.name),
		// Drives the git-poll sweep: find enabled services that are due.
		index('services_auto_deploy_next_poll_idx').on(table.autoDeployEnabled, table.nextPollAt),
		// Drives the tag-watch sweep for docker-image services.
		index('services_image_watch_next_watch_idx').on(table.imageWatchEnabled, table.nextWatchAt)
	]
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;

// Allocation source of truth for public TCP ports: public_port is unique cluster-wide, which the JSONB config copy (RuntimeConfig.exposedPorts) can't enforce.
export const servicePortExposures = pgTable(
	'service_port_exposures',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		serviceId: uuid('service_id')
			.notNull()
			.references(() => services.id, { onDelete: 'cascade' }),
		containerPort: integer('container_port').notNull(),
		// Allocated from the platform TCP pool (workloadIngress.tcpPortPool); names the Traefik entrypoint `tcp-<publicPort>`.
		publicPort: integer('public_port').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		uniqueIndex('service_port_exposures_public_port_unique').on(table.publicPort),
		uniqueIndex('service_port_exposures_service_container_port_unique').on(table.serviceId, table.containerPort)
	]
);

export type ServicePortExposureRow = typeof servicePortExposures.$inferSelect;
export type NewServicePortExposureRow = typeof servicePortExposures.$inferInsert;

export const serviceFlowNodes = pgTable(
	'service_flow_nodes',
	{
		environmentId: uuid('environment_id')
			.notNull()
			.references(() => environments.id, { onDelete: 'cascade' }),
		serviceId: uuid('service_id')
			.notNull()
			.references(() => services.id, { onDelete: 'cascade' }),
		x: doublePrecision('x').notNull(),
		y: doublePrecision('y').notNull(),
		revision: integer('revision').notNull().default(1),
		updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		primaryKey({ columns: [table.environmentId, table.serviceId] }),
		index('service_flow_nodes_service_id_idx').on(table.serviceId),
		check('service_flow_nodes_revision_positive_ck', sql`${table.revision} > 0`)
	]
);

export type ServiceFlowNode = typeof serviceFlowNodes.$inferSelect;
export type NewServiceFlowNode = typeof serviceFlowNodes.$inferInsert;

export const refreshTokens = pgTable('refresh_tokens', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	tokenHash: text('token_hash').notNull().unique(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export type RefreshToken = typeof refreshTokens.$inferSelect;

export const invitations = pgTable('invitations', {
	id: uuid('id').primaryKey().defaultRandom(),
	email: text('email').notNull(),
	tokenHash: text('token_hash').notNull().unique(),
	isAdmin: boolean('is_admin').notNull().default(false),
	invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	acceptedAt: timestamp('accepted_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export const passwordResetTokens = pgTable('password_reset_tokens', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	tokenHash: text('token_hash').notNull().unique(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	usedAt: timestamp('used_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export const settings = pgTable('settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export type Setting = typeof settings.$inferSelect;

// NOTE: partial unique index `update_runs_single_active` (at most one active run) can't be expressed in drizzle, so it lives in migration 0007, not here.
export const updateRuns = pgTable('update_runs', {
	id: uuid('id').primaryKey().defaultRandom(),
	kind: text('kind').notNull().default('version'),
	fromVersion: text('from_version').notNull(),
	toVersion: text('to_version').notNull(),
	status: text('status').notNull(),
	startedAt: timestamp('started_at', { withTimezone: true }),
	finishedAt: timestamp('finished_at', { withTimezone: true }),
	phase: text('phase'),
	lastError: text('last_error'),
	jobName: text('job_name'),
	oldImageTags: jsonb('old_image_tags'),
	triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export type UpdateRun = typeof updateRuns.$inferSelect;
export type NewUpdateRun = typeof updateRuns.$inferInsert;

export type DeploymentStatus = 'pending' | 'deploying' | 'canceling' | 'succeeded' | 'failed' | 'superseded' | 'canceled';

export const deploymentTrigger = pgEnum('deployment_trigger', ['manual', 'auto', 'preview']);
export type DeploymentTrigger = (typeof deploymentTrigger.enumValues)[number];

export type DeploymentLogLevel = 'info' | 'warn' | 'error';
export const deploymentLogKind = pgEnum('deployment_log_kind', ['event', 'build-output']);
export type DeploymentLogKind = (typeof deploymentLogKind.enumValues)[number];

export interface DeploymentLogEntry {
	ts: string;
	level: DeploymentLogLevel;
	step: string;
	message: string;
}

export const deployments = pgTable(
	'deployments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		serviceId: uuid('service_id')
			.notNull()
			.references(() => services.id, { onDelete: 'cascade' }),
		type: serviceType('type').notNull(),
		config: jsonb('config').$type<ServiceConfig>().notNull(),
		imageRef: text('image_ref'),
		status: text('status').notNull().default('pending'),
		phase: text('phase'),
		lastError: text('last_error'),
		lockedBy: text('locked_by'),
		lockedAt: timestamp('locked_at', { withTimezone: true }),
		attempts: integer('attempts').notNull().default(0),
		rollbackAttempts: integer('rollback_attempts').notNull().default(0),
		trigger: deploymentTrigger('trigger').notNull().default('manual'),
		triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [index('deployments_service_id_created_at_idx').on(table.serviceId, table.createdAt), index('deployments_status_idx').on(table.status)]
);

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;

// Append-only: `event` rows are platform progress, `build-output` raw build-pod stdout/stderr; sourceTs+lineHash make capture idempotent across restarts/takeovers.
export const deploymentLogs = pgTable(
	'deployment_logs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		deploymentId: uuid('deployment_id')
			.notNull()
			.references(() => deployments.id, { onDelete: 'cascade' }),
		kind: deploymentLogKind('kind').notNull(),
		ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
		level: text('level').notNull().default('info').$type<DeploymentLogLevel>(),
		step: text('step').notNull(),
		message: text('message').notNull(),
		containerName: text('container_name'),
		sourceTs: timestamp('source_ts', { withTimezone: true }),
		lineHash: text('line_hash')
	},
	table => [
		index('deployment_logs_deployment_id_ts_idx').on(table.deploymentId, table.ts),
		uniqueIndex('deployment_logs_build_line_unique').on(table.deploymentId, table.containerName, table.sourceTs, table.lineHash)
	]
);

export type DeploymentLog = typeof deploymentLogs.$inferSelect;
export type NewDeploymentLog = typeof deploymentLogs.$inferInsert;
