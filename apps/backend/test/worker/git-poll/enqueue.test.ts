import { afterEach, describe, expect, mock, test } from 'bun:test';

// enqueueAutoDeployment: advisory lock → supersede pending → insert the pinned auto deployment + log.

interface Insert {
	table: string;
	values: unknown[];
}
let inserts: Insert[] = [];
let updateSets: Record<string, unknown>[] = [];
let executeCalls = 0;
let returningIds: string[] = ['dep-1'];

function tableName(t: { __t?: string }): string {
	return t.__t ?? '?';
}

const tx = {
	execute: async () => {
		executeCalls++;
	},
	update: () => ({
		set: (set: Record<string, unknown>) => {
			updateSets.push(set);
			return { where: async () => undefined };
		}
	}),
	insert: (table: { __t?: string }) => ({
		values: (values: unknown) => {
			const arr = Array.isArray(values) ? values : [values];
			inserts.push({ table: tableName(table), values: arr });
			return { returning: () => returningIds.map(id => ({ id })) };
		}
	})
};

mock.module('@kubwave/db', () => ({
	deployments: { __t: 'deployments', serviceId: 'serviceId', status: 'status', id: 'id' },
	deploymentLogs: { __t: 'deploymentLogs' },
	db: {
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)
	}
}));

const { enqueueAutoDeployment } = await import('~/modules/worker/jobs/git-poll/enqueue');

const service = {
	id: 'svc-1',
	type: 'public-repo' as const,
	config: { repoUrl: 'https://x/r.git', branch: 'main', commit: '' } as never
};
const COMMIT = 'a'.repeat(40);

function find(table: string): Insert | undefined {
	return inserts.find(i => i.table === table);
}

afterEach(() => {
	inserts = [];
	updateSets = [];
	executeCalls = 0;
	returningIds = ['dep-1'];
});

describe('enqueueAutoDeployment', () => {
	test('takes the advisory lock, supersedes pending, inserts the pinned auto deployment + log', async () => {
		await enqueueAutoDeployment(service, COMMIT);
		expect(executeCalls).toBe(1); // pg_advisory_xact_lock

		expect(updateSets).toHaveLength(1);
		expect(updateSets[0]!.status).toBe('superseded');
		expect(updateSets[0]!.finishedAt).toBeInstanceOf(Date);

		const dep = find('deployments')!.values[0] as Record<string, unknown>;
		expect(dep.serviceId).toBe('svc-1');
		expect(dep.type).toBe('public-repo');
		expect(dep.status).toBe('pending');
		expect(dep.trigger).toBe('auto');
		expect(dep.triggeredByUserId).toBeNull();
		// commit pinned into the snapshot config (service config keeps tracking the branch).
		expect((dep.config as { commit: string }).commit).toBe(COMMIT);

		const logs = find('deploymentLogs')!.values as Array<{ message: string }>;
		expect(logs).toHaveLength(1);
		expect(logs[0]!.message).toContain(COMMIT.slice(0, 7));
	});

	test('skips the log insert when the deployment insert returns no row', async () => {
		returningIds = []; // returning() yields nothing
		await enqueueAutoDeployment(service, COMMIT);
		expect(find('deployments')).toBeDefined();
		expect(find('deploymentLogs')).toBeUndefined();
	});
});
