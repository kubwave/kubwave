export type RuntimeStatus = 'running' | 'degraded' | 'progressing' | 'failed' | 'stopped' | 'not_deployed' | 'unknown';
export type DeploymentStatus = 'pending' | 'deploying' | 'canceling' | 'succeeded' | 'failed' | 'superseded' | 'canceled';
export type ServiceType =
	'docker-image' | 'dockerfile' | 'public-repo' | 'private-repo' | 'github-repo' | 'gitea-repo' | 'postgres' | 'mysql' | 'mariadb' | 'mongodb';

export type Team = { id: string; name: string; role: 'owner' | 'member'; members: number; joinedAt: string; isDefault: boolean };

export type EnvVar = { key: string; value: string; secret?: boolean };

export type Service = {
	id: string;
	name: string;
	type: ServiceType;
	source: string;
	branch?: string;
	status: RuntimeStatus;
	replicas: [number, number];
	port?: number;
	domain?: string;
	internalHost: string;
	vars: EnvVar[];
	volume?: { name: string; mountPath: string; size: string; usedPct: number };
	position: { x: number; y: number };
	lastDeploy: { status: DeploymentStatus; ago: string; commit?: string; message?: string };
};

export type Environment = { id: string; name: string; kind: 'persistent' | 'preview'; prNumber?: number; services: Service[] };

export type Project = {
	id: string;
	teamId: string;
	name: string;
	description: string;
	updatedAgo: string;
	prPreviews: boolean;
	environments: Environment[];
};

export type DeploymentEvent = { at: string; level: 'info' | 'warn' | 'error'; step: string; message: string };

export type Deployment = {
	id: string;
	status: DeploymentStatus;
	phase: string;
	trigger: 'manual' | 'auto' | 'preview';
	commit?: string;
	message: string;
	author: string;
	createdAt: string;
	ago: string;
	duration: string;
	error?: string;
	events: DeploymentEvent[];
	buildLog: string[];
};

export const currentUser = { name: 'Alex Morgan', email: 'alex@acme.dev', initials: 'AM', isAdmin: true };

export const teams: Team[] = [
	{ id: 'acme', name: 'Acme', role: 'owner', members: 6, joinedAt: 'Mar 2, 2025', isDefault: true },
	{ id: 'personal', name: 'Personal', role: 'owner', members: 1, joinedAt: 'Mar 2, 2025', isDefault: false },
	{ id: 'oss', name: 'Open Source Guild', role: 'member', members: 14, joinedAt: 'Jan 18, 2026', isDefault: false }
];

export const serviceTypeLabel: Record<ServiceType, string> = {
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

export const isDatabase = (t: ServiceType) => t === 'postgres' || t === 'mysql' || t === 'mariadb' || t === 'mongodb';

function svc(s: Omit<Service, 'internalHost'> & { internalHost?: string }): Service {
	return { internalHost: `${s.name}.svc.cluster.local`, ...s };
}

const storefrontProduction: Service[] = [
	svc({
		id: 'web',
		name: 'web',
		type: 'github-repo',
		source: 'acme/storefront-web',
		branch: 'main',
		status: 'running',
		replicas: [3, 3],
		port: 3000,
		domain: 'shop.acme.dev',
		position: { x: 0, y: 0 },
		vars: [
			{ key: 'NODE_ENV', value: 'production' },
			{ key: 'API_URL', value: '${{services.api.internalUrl}}' },
			{ key: 'PUBLIC_URL', value: 'https://shop.acme.dev' },
			{ key: 'SESSION_SECRET', value: 'b3f1c9a7e4d2', secret: true }
		],
		lastDeploy: { status: 'succeeded', ago: '12m ago', commit: 'a41c9e2', message: 'feat(cart): persist cart across sessions' }
	}),
	svc({
		id: 'api',
		name: 'api',
		type: 'github-repo',
		source: 'acme/storefront-api',
		branch: 'main',
		status: 'running',
		replicas: [2, 2],
		port: 8080,
		domain: 'api.acme.dev',
		position: { x: 360, y: 0 },
		vars: [
			{ key: 'DATABASE_URL', value: 'postgres://app:${{services.postgres.password}}@${{services.postgres.host}}:5432/app' },
			{ key: 'REDIS_URL', value: 'redis://${{services.redis.host}}:6379' },
			{ key: 'LOG_LEVEL', value: 'info' },
			{ key: 'STRIPE_KEY', value: 'sk_live_51Mx', secret: true },
			{ key: 'JWT_SECRET', value: '9f8e7d6c5b4a', secret: true }
		],
		lastDeploy: { status: 'succeeded', ago: '2h ago', commit: '7be03d1', message: 'fix(orders): idempotent webhook handling' }
	}),
	svc({
		id: 'worker',
		name: 'worker',
		type: 'private-repo',
		source: 'git@git.acme.dev:platform/jobs.git',
		branch: 'main',
		status: 'degraded',
		replicas: [1, 2],
		position: { x: 360, y: 220 },
		vars: [
			{ key: 'QUEUE_URL', value: 'redis://${{services.redis.host}}:6379/1' },
			{ key: 'CONCURRENCY', value: '8' }
		],
		lastDeploy: { status: 'succeeded', ago: '1d ago', commit: 'c09f5aa', message: 'chore: bump bullmq' }
	}),
	svc({
		id: 'postgres',
		name: 'postgres',
		type: 'postgres',
		source: 'PostgreSQL 17',
		status: 'running',
		replicas: [1, 1],
		port: 5432,
		position: { x: 720, y: -40 },
		volume: { name: 'postgres-data', mountPath: '/var/lib/postgresql/data', size: '20Gi', usedPct: 42 },
		vars: [
			{ key: 'POSTGRES_USER', value: 'app' },
			{ key: 'POSTGRES_PASSWORD', value: 'q8Zp2LmN4x', secret: true },
			{ key: 'POSTGRES_DB', value: 'app' }
		],
		lastDeploy: { status: 'succeeded', ago: '9d ago' }
	}),
	svc({
		id: 'redis',
		name: 'redis',
		type: 'docker-image',
		source: 'redis:7.4-alpine',
		status: 'running',
		replicas: [1, 1],
		port: 6379,
		position: { x: 720, y: 220 },
		volume: { name: 'redis-data', mountPath: '/data', size: '2Gi', usedPct: 18 },
		vars: [],
		lastDeploy: { status: 'succeeded', ago: '9d ago' }
	})
];

function envVariant(services: Service[], patch: (s: Service) => Service | null): Service[] {
	return services.map(patch).filter((s): s is Service => s !== null);
}

export const projects: Project[] = [
	{
		id: 'storefront',
		teamId: 'acme',
		name: 'storefront',
		description: 'Customer-facing shop, API and background jobs.',
		updatedAgo: '12m ago',
		prPreviews: true,
		environments: [
			{ id: 'production', name: 'production', kind: 'persistent', services: storefrontProduction },
			{
				id: 'staging',
				name: 'staging',
				kind: 'persistent',
				services: envVariant(storefrontProduction, s => ({
					...s,
					replicas: [1, 1],
					domain: s.domain?.replace('acme.dev', 'staging.acme.dev'),
					status: s.id === 'worker' ? 'running' : s.id === 'api' ? 'progressing' : s.status,
					lastDeploy:
						s.id === 'api' ? { status: 'deploying', ago: 'just now', commit: 'e2d7f10', message: 'feat(search): typo tolerance' } : s.lastDeploy
				}))
			},
			{
				id: 'pr-42',
				name: 'PR #42',
				kind: 'preview',
				prNumber: 42,
				services: envVariant(storefrontProduction, s =>
					s.id === 'worker' || s.id === 'redis'
						? null
						: {
								...s,
								replicas: [1, 1],
								branch: 'feat/checkout-v2',
								domain: s.domain ? `pr-42-${s.name}.preview.acme.dev` : undefined,
								status: s.id === 'web' ? 'failed' : s.status,
								lastDeploy: s.id === 'web' ? { status: 'failed', ago: '34m ago', commit: '3f1aa09', message: 'wip: new checkout' } : s.lastDeploy
							}
				)
			},
			{ id: 'pr-57', name: 'PR #57', kind: 'preview', prNumber: 57, services: [] }
		]
	},
	{
		id: 'analytics',
		teamId: 'acme',
		name: 'analytics',
		description: 'Self-hosted Plausible for all marketing sites.',
		updatedAgo: '3d ago',
		prPreviews: false,
		environments: [
			{
				id: 'production',
				name: 'production',
				kind: 'persistent',
				services: [
					svc({
						id: 'plausible',
						name: 'plausible',
						type: 'docker-image',
						source: 'ghcr.io/plausible/community-edition:v2.1',
						status: 'running',
						replicas: [1, 1],
						port: 8000,
						domain: 'stats.acme.dev',
						position: { x: 0, y: 40 },
						vars: [
							{ key: 'BASE_URL', value: 'https://stats.acme.dev' },
							{ key: 'DATABASE_URL', value: '${{services.plausible-db.url}}' },
							{ key: 'CLICKHOUSE_DATABASE_URL', value: 'http://${{services.clickhouse.host}}:8123/plausible' },
							{ key: 'SECRET_KEY_BASE', value: 'kq93nd81', secret: true }
						],
						lastDeploy: { status: 'succeeded', ago: '3d ago' }
					}),
					svc({
						id: 'plausible-db',
						name: 'plausible-db',
						type: 'postgres',
						source: 'PostgreSQL 16',
						status: 'running',
						replicas: [1, 1],
						port: 5432,
						position: { x: 380, y: -60 },
						volume: { name: 'plausible-db-data', mountPath: '/var/lib/postgresql/data', size: '10Gi', usedPct: 23 },
						vars: [],
						lastDeploy: { status: 'succeeded', ago: '3d ago' }
					}),
					svc({
						id: 'clickhouse',
						name: 'clickhouse',
						type: 'docker-image',
						source: 'clickhouse/clickhouse-server:24.3-alpine',
						status: 'running',
						replicas: [1, 1],
						port: 8123,
						position: { x: 380, y: 160 },
						volume: { name: 'clickhouse-data', mountPath: '/var/lib/clickhouse', size: '50Gi', usedPct: 81 },
						vars: [],
						lastDeploy: { status: 'succeeded', ago: '3d ago' }
					})
				]
			}
		]
	},
	{
		id: 'internal-tools',
		teamId: 'acme',
		name: 'internal-tools',
		description: 'Admin dashboards and cron jobs.',
		updatedAgo: '2w ago',
		prPreviews: false,
		environments: [
			{
				id: 'production',
				name: 'production',
				kind: 'persistent',
				services: [
					svc({
						id: 'backoffice',
						name: 'backoffice',
						type: 'dockerfile',
						source: 'Built from Dockerfile',
						status: 'stopped',
						replicas: [0, 1],
						port: 4000,
						position: { x: 0, y: 0 },
						vars: [{ key: 'MONGO_URL', value: '${{services.mongo.url}}' }],
						lastDeploy: { status: 'canceled', ago: '2w ago' }
					}),
					svc({
						id: 'mongo',
						name: 'mongo',
						type: 'mongodb',
						source: 'MongoDB 8',
						status: 'running',
						replicas: [1, 1],
						port: 27017,
						position: { x: 380, y: 0 },
						volume: { name: 'mongo-data', mountPath: '/data/db', size: '5Gi', usedPct: 9 },
						vars: [],
						lastDeploy: { status: 'succeeded', ago: '2w ago' }
					})
				]
			},
			{ id: 'staging', name: 'staging', kind: 'persistent', services: [] }
		]
	}
];

// Stand-in route for projects created in the preview, which can't get their own static page.
export const draftProject: Project = {
	id: 'new',
	teamId: 'acme',
	name: 'new-project',
	description: '',
	updatedAgo: 'just now',
	prPreviews: false,
	environments: [{ id: 'production', name: 'production', kind: 'persistent', services: [] }]
};

export const getProject = (id: string) => projects.find(p => p.id === id) ?? (id === draftProject.id ? draftProject : undefined);

export const projectHref = (id: string) => `/project/${projects.some(p => p.id === id) ? id : draftProject.id}`;

export type ActivityItem = { id: string; service: string; project: string; env: string; status: DeploymentStatus; ago: string; message: string };

export const activity: ActivityItem[] = [
	{ id: 'a1', service: 'api', project: 'storefront', env: 'staging', status: 'deploying', ago: 'just now', message: 'feat(search): typo tolerance' },
	{
		id: 'a2',
		service: 'web',
		project: 'storefront',
		env: 'production',
		status: 'succeeded',
		ago: '12m ago',
		message: 'feat(cart): persist cart across sessions'
	},
	{ id: 'a3', service: 'web', project: 'storefront', env: 'PR #42', status: 'failed', ago: '34m ago', message: 'wip: new checkout' },
	{
		id: 'a4',
		service: 'api',
		project: 'storefront',
		env: 'production',
		status: 'succeeded',
		ago: '2h ago',
		message: 'fix(orders): idempotent webhook handling'
	},
	{ id: 'a5', service: 'worker', project: 'storefront', env: 'production', status: 'succeeded', ago: '1d ago', message: 'chore: bump bullmq' },
	{ id: 'a6', service: 'plausible', project: 'analytics', env: 'production', status: 'succeeded', ago: '3d ago', message: 'Image updated to v2.1' },
	{ id: 'a7', service: 'backoffice', project: 'internal-tools', env: 'production', status: 'canceled', ago: '2w ago', message: 'Manual deploy' }
];

const buildLog = (service: string, failed = false) => [
	'\x1b[36m[build]\x1b[0m cloning repository',
	`\x1b[36m[build]\x1b[0m checked out ${service}@main`,
	'\x1b[36m[build]\x1b[0m nixpacks v1.29.0 detected: Node.js 24',
	'\x1b[2m#1 [internal] load build definition from Dockerfile\x1b[0m',
	'\x1b[2m#2 [internal] load metadata for docker.io/library/node:24-alpine\x1b[0m',
	'#3 [1/6] FROM docker.io/library/node:24-alpine',
	'#4 [2/6] WORKDIR /app',
	'#5 [3/6] COPY package.json bun.lock ./',
	'#6 [4/6] RUN bun install --frozen-lockfile',
	'#6 1.92s 412 packages installed',
	'#7 [5/6] COPY . .',
	'#8 [6/6] RUN bun run build',
	...(failed
		? [
				'#8 4.12s \x1b[31merror\x1b[0m TS2339: Property \x1b[1mtotal\x1b[0m does not exist on type \x1b[1mCart\x1b[0m.',
				'#8 4.13s   at src/checkout/summary.tsx:42:17',
				'\x1b[31mERROR: failed to solve: process "/bin/sh -c bun run build" did not complete successfully: exit code: 1\x1b[0m'
			]
		: [
				'#8 6.48s \x1b[32m✓\x1b[0m Compiled successfully',
				'#9 exporting to image',
				'#9 pushing layers 3/3 \x1b[32mdone\x1b[0m',
				`\x1b[32m[build]\x1b[0m pushed registry.kubwave.internal/acme/${service}:a41c9e2`
			])
];

export function deploymentsFor(service: Service): Deployment[] {
	const failed = service.lastDeploy.status === 'failed';
	const head: Deployment = {
		id: 'd-1',
		status: service.lastDeploy.status,
		phase: service.lastDeploy.status === 'deploying' ? 'building' : failed ? 'build' : 'done',
		trigger: 'auto',
		commit: service.lastDeploy.commit,
		message: service.lastDeploy.message ?? 'Manual deploy',
		author: 'alex',
		createdAt: 'Sep 28, 14:02',
		ago: service.lastDeploy.ago,
		duration: service.lastDeploy.status === 'deploying' ? '0:48' : '1:52',
		error: failed ? 'Build failed: process "/bin/sh -c bun run build" exited with code 1' : undefined,
		events: [
			{ at: '14:02:01', level: 'info', step: 'build-started', message: 'Build started on builder-7f9c' },
			{ at: '14:02:09', level: 'info', step: 'building', message: 'Building image with nixpacks' },
			...(failed
				? [{ at: '14:02:31', level: 'error' as const, step: 'failed', message: 'Build step exited with code 1' }]
				: service.lastDeploy.status === 'deploying'
					? []
					: [
							{ at: '14:03:12', level: 'info' as const, step: 'pushing', message: 'Pushing image to registry' },
							{ at: '14:03:30', level: 'info' as const, step: 'build-succeeded', message: 'Image pushed' },
							{ at: '14:03:41', level: 'warn' as const, step: 'rollout', message: 'Readiness probe failed once, retrying' },
							{
								at: '14:03:53',
								level: 'info' as const,
								step: 'succeeded',
								message: `Rollout complete, ${service.replicas[1]}/${service.replicas[1]} ready`
							}
						])
		],
		buildLog: buildLog(service.name, failed)
	};
	const older: Deployment[] = [
		['d-2', 'superseded', '2h ago', 'b72e1f0', 'refactor: split pricing module'],
		['d-3', 'superseded', '1d ago', '4c8d2e9', 'feat: add sitemap'],
		['d-4', 'failed', '2d ago', 'e91f3b4', 'chore: upgrade next'],
		['d-5', 'canceled', '4d ago', '0aa3c7d', 'Manual deploy'],
		['d-6', 'superseded', '6d ago', '5d1e0b8', 'fix: header overflow on mobile']
	].map(([id, status, ago, commit, message]) => ({
		id: id!,
		status: status as DeploymentStatus,
		phase: status === 'failed' ? 'build' : 'done',
		trigger: 'auto',
		commit,
		message: message!,
		author: 'sam',
		createdAt: 'Sep 26, 09:14',
		ago: ago!,
		duration: '2:04',
		error: status === 'failed' ? 'Build failed: process "/bin/sh -c bun run build" exited with code 1' : undefined,
		events: [
			{ at: '09:14:02', level: 'info', step: 'build-started', message: 'Build started' },
			{
				at: '09:16:06',
				level: status === 'failed' ? 'error' : 'info',
				step: status === 'failed' ? 'failed' : 'succeeded',
				message: status === 'failed' ? 'Build step exited with code 1' : 'Rollout complete'
			}
		],
		buildLog: buildLog(service.name, status === 'failed')
	}));
	return [head, ...older];
}

const logTemplates = [
	'GET /api/products 200 in 23ms',
	'GET /api/cart 200 in 11ms',
	'POST /api/checkout 201 in 184ms',
	'GET /healthz 200 in 1ms',
	'cache hit ratio 0.94 (window 60s)',
	'WARN slow query 412ms: SELECT * FROM orders WHERE customer_id = $1',
	'GET /api/products/sku-2231 404 in 6ms',
	'job email.send completed in 320ms',
	'ERROR upstream timeout after 5000ms: payments.acme.internal',
	'GET /static/app.js 304 in 2ms'
];

const logWeights = [0, 0, 0, 1, 1, 2, 3, 3, 3, 3, 4, 5, 6, 7, 7, 8, 9, 9, 0, 1];

export function logLine(service: Service, i: number) {
	const h = Math.imul(i + service.name.length * 31, 2654435761) >>> 0;
	const pod = `${service.name}-7d9c8b${['x2kq', 'p9mz', 'tq4l'][h % Math.max(1, service.replicas[1])]}`;
	const t = 600 + i * 3 + (h % 3);
	const time = `14:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
	return { id: i, pod, time, message: logTemplates[logWeights[(h >>> 8) % logWeights.length]!]! };
}

export function series(seed: number, points: number, base: number, amp: number) {
	let x = seed;
	return Array.from({ length: points }, (_, i) => {
		x = (x * 9301 + 49297) % 233280;
		const noise = x / 233280 - 0.5;
		return Math.max(0, base + Math.sin((i + seed) / 5) * amp * 0.6 + noise * amp);
	});
}

export const templates = [
	{ id: 'ghost', name: 'Ghost', description: 'Publishing platform for blogs and newsletters.' },
	{ id: 'gitlab', name: 'GitLab', description: 'Self-hosted Git, CI/CD and issue tracking.' },
	{ id: 'plausible', name: 'Plausible', description: 'Privacy-friendly web analytics.' },
	{ id: 'supabase', name: 'Supabase', description: 'Postgres with auth, storage and realtime.' },
	{ id: 'uptime-kuma', name: 'Uptime Kuma', description: 'Self-hosted status monitoring.' },
	{ id: 'kodus', name: 'Kodus', description: 'AI code review agent.' }
];

export const databaseEngines = [
	{ type: 'postgres' as const, name: 'PostgreSQL', versions: ['17', '16', '15'] },
	{ type: 'mysql' as const, name: 'MySQL', versions: ['8.4', '8.0'] },
	{ type: 'mariadb' as const, name: 'MariaDB', versions: ['11.4', '10.11'] },
	{ type: 'mongodb' as const, name: 'MongoDB', versions: ['8', '7'] }
];
