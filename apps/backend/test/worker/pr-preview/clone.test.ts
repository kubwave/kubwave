import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { OpenPr } from '~/modules/worker/jobs/pr-preview/providers';

// clonePreview plans + inserts the preview env, copied services, deployments and logs in one tx; only @kubwave/db is faked.

// Outer reads: db.select(...).from(...).where(...) resolves the queued result, in order.
let selectResults: unknown[][] = [];
let selectIdx = 0;

interface Insert {
	table: string;
	values: unknown[];
}
let inserts: Insert[] = [];
// Ids handed back from deployments.returning(), one per inserted deployment row.
let deploymentIds: string[] = [];

function tableName(t: { __t?: string }): string {
	return t.__t ?? 'unknown';
}

const tx = {
	insert: (table: { __t?: string }) => ({
		values: (values: unknown) => {
			const arr = Array.isArray(values) ? values : [values];
			inserts.push({ table: tableName(table), values: arr });
			return {
				returning: () => deploymentIds.map(id => ({ id }))
			};
		}
	})
};

mock.module('@kubwave/db', () => ({
	environments: { __t: 'environments', environmentId: 'environmentId', id: 'id' },
	services: { __t: 'services', environmentId: 'environmentId' },
	deployments: { __t: 'deployments', serviceId: 'serviceId', status: 'status', id: 'id' },
	deploymentLogs: { __t: 'deploymentLogs' },
	buildDefaultDomainForService: (_settings: unknown, _runtime: unknown, service: { serviceId: string; serviceName: string }) =>
		`${service.serviceName}-${service.serviceId.replace(/-/g, '').slice(0, 8)}.kubwave.com`,
	db: {
		select: () => ({ from: () => ({ where: async () => selectResults[selectIdx++] ?? [] }) }),
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)
	}
}));

mock.module('~/shared/cluster/default-domain', () => ({
	getDefaultDomainSettings: async () => ({ mode: 'wildcard', base: 'kubwave.com', subdomainTemplate: null }),
	getDefaultDomainRuntime: async () => ({ ingressIp: null, tls: false })
}));

const { clonePreview } = await import('~/modules/worker/jobs/pr-preview/clone');

const base = { id: 'BASE', projectId: 'proj-1' } as never;
const pr: OpenPr = { prNumber: 42, prRef: 'refs/pull/42/head', headSha: 'f'.repeat(40) };
const prRepoUrl = 'git@gitea.example:org/app.git';

function repoService(id: string, name: string) {
	return {
		id,
		name,
		type: 'private-repo',
		environmentId: 'BASE',
		config: {
			repoUrl: prRepoUrl,
			branch: 'main',
			sshKeyId: 'k',
			builder: 'nixpacks',
			containerPort: 3000,
			env: [] as { key: string; value: string }[],
			domains: [] as { host: string; port: number }[],
			volumes: [] as { name: string; mountPath: string; size: string }[]
		} as {
			repoUrl: string;
			branch: string;
			sshKeyId: string;
			builder: string;
			containerPort: number;
			defaultDomainEnabled?: boolean;
			env: { key: string; value: string }[];
			domains: { host: string; port: number }[];
			volumes: { name: string; mountPath: string; size: string }[];
		}
	};
}
function imageService(id: string, name: string) {
	return {
		id,
		name,
		type: 'docker-image',
		environmentId: 'BASE',
		config: { image: 'img', tag: '1', containerPort: 80, env: [], domains: [], volumes: [] }
	};
}

function find(table: string): Insert | undefined {
	return inserts.find(i => i.table === table);
}

afterEach(() => {
	selectResults = [];
	selectIdx = 0;
	inserts = [];
	deploymentIds = [];
});

describe('clonePreview', () => {
	test('inserts the preview env + copied services + a pending deployment + queued logs', async () => {
		// reads: [0] base services, [1] succeeded deployments (svc-pr + svc-run both ran)
		selectResults = [
			[repoService('svc-pr', 'pr'), imageService('svc-run', 'run')],
			[{ serviceId: 'svc-pr' }, { serviceId: 'svc-run' }]
		];
		deploymentIds = ['dep-1', 'dep-2'];
		await clonePreview(base, pr, prRepoUrl);

		const envInsert = find('environments')!;
		expect(envInsert.values).toHaveLength(1);
		const envRow = envInsert.values[0] as Record<string, unknown>;
		expect(envRow.kind).toBe('preview');
		expect(envRow.prPreviewsEnabled).toBe(false);
		expect(envRow.baseEnvironmentId).toBe('BASE');
		expect(envRow.prNumber).toBe(42);
		expect(envRow.prRepoUrl).toBe(prRepoUrl);
		expect(envRow.prRef).toBe('refs/pull/42/head');
		expect(envRow.projectId).toBe('proj-1');
		expect(envRow.name).toBe('pr-42-app'); // slug(repoUrl) = "app"

		expect(find('services')!.values).toHaveLength(2);

		// both are deployable (pr tracks the PR repo; run succeeded in base) → 2 deployments
		const deps = find('deployments')!.values as Array<Record<string, unknown>>;
		expect(deps).toHaveLength(2);
		for (const d of deps) {
			expect(d.status).toBe('pending');
			expect(d.trigger).toBe('preview');
			expect(d.triggeredByUserId).toBeNull();
		}

		const logs = find('deploymentLogs')!.values as Array<Record<string, unknown>>;
		expect(logs).toHaveLength(2);
		expect((logs[0] as { message: string }).message).toContain('PR #42 preview');
	});

	test('rewrites base default-domain env values with the preview service host', async () => {
		const svc = repoService('0820689f-0000-0000-0000-000000000000', 'docs');
		svc.config = {
			...svc.config,
			defaultDomainEnabled: true,
			env: [{ key: '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', value: 'docs-0820689f.kubwave.com' }]
		};
		selectResults = [[svc], []];

		await clonePreview(base, pr, prRepoUrl);

		const serviceRow = find('services')!.values[0] as { id: string; config: { env: Array<{ key: string; value: string }> } };
		expect(serviceRow.config.env).toEqual([
			{ key: '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', value: `docs-${serviceRow.id.replace(/-/g, '').slice(0, 8)}.kubwave.com` }
		]);
		expect(serviceRow.config.env[0]!.value).not.toBe('docs-0820689f.kubwave.com');
	});

	test('copies services but inserts NO deployments/logs when none are deployable', async () => {
		// svc-idle is a plain image never deployed in base and not the PR repo → not deployable.
		selectResults = [
			[imageService('svc-idle', 'idle')],
			[] // no succeeded deployments
		];
		await clonePreview(base, pr, prRepoUrl);
		expect(find('environments')!.values).toHaveLength(1);
		expect(find('services')!.values).toHaveLength(1);
		expect(find('deployments')).toBeUndefined();
		expect(find('deploymentLogs')).toBeUndefined();
	});

	test('inserts only the env row when the base has no services at all', async () => {
		selectResults = [[]]; // no base services → succeeded query is skipped entirely
		await clonePreview(base, pr, prRepoUrl);
		expect(find('environments')!.values).toHaveLength(1);
		expect(find('services')).toBeUndefined();
		expect(find('deployments')).toBeUndefined();
		// succeeded-deployments select must be SKIPPED when there are no base ids.
		expect(selectIdx).toBe(1);
	});

	test('skips the log insert when the deployment insert returns no ids', async () => {
		selectResults = [[repoService('svc-pr', 'pr')], [{ serviceId: 'svc-pr' }]];
		deploymentIds = []; // returning() yields nothing
		await clonePreview(base, pr, prRepoUrl);
		expect(find('deployments')!.values).toHaveLength(1); // values were still passed
		expect(find('deploymentLogs')).toBeUndefined(); // but no logs (no returned ids)
	});

	test('propagates a duplicate-insert error (idempotency: caller skips on the unique index)', async () => {
		selectResults = [[repoService('svc-pr', 'pr')], []];
		// Make the env insert throw like the unique (base, repo, pr_number) violation would.
		const throwingTx = {
			insert: () => ({
				values: () => {
					throw new Error('duplicate key value violates unique constraint');
				}
			})
		};
		const db = (await import('@kubwave/db')).db as { transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
		const orig = db.transaction;
		db.transaction = async fn => fn(throwingTx);
		try {
			await expect(clonePreview(base, pr, prRepoUrl)).rejects.toThrow('duplicate key');
		} finally {
			db.transaction = orig;
		}
	});
});
