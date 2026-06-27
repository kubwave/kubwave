import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ServicesService } from '~/modules/services/services.service';

type DeploymentRow = {
	id: string;
	serviceId: string;
	type: 'dockerfile';
	config: { dockerfile: string; containerPort: number; env: never[]; domains: never[]; volumes: never[] };
	status: string;
	phase: string | null;
	lastError: string | null;
	lockedBy: string | null;
	lockedAt: Date | null;
	attempts: number;
	rollbackAttempts: number;
	trigger: 'manual';
	triggeredByUserId: string | null;
	startedAt: Date | null;
	finishedAt: Date | null;
	createdAt: Date;
	imageRef: string | null;
};

let currentRow: DeploymentRow;
let updateValues: Record<string, unknown> | null = null;
const insertedLogs: unknown[] = [];

function row(overrides: Partial<DeploymentRow> = {}): DeploymentRow {
	return {
		id: 'dep-1',
		serviceId: 'svc-1',
		type: 'dockerfile',
		config: { dockerfile: 'FROM nginx:1.27', containerPort: 80, env: [], domains: [], volumes: [] },
		status: 'deploying',
		phase: 'building',
		lastError: 'old error',
		lockedBy: null,
		lockedAt: null,
		attempts: 1,
		rollbackAttempts: 2,
		trigger: 'manual',
		triggeredByUserId: 'user-1',
		startedAt: new Date('2026-06-20T10:00:00.000Z'),
		finishedAt: null,
		createdAt: new Date('2026-06-20T10:00:00.000Z'),
		imageRef: null,
		...overrides
	};
}

function rowsThenable(rows: DeploymentRow[]) {
	const promise = Promise.resolve(rows) as Promise<DeploymentRow[]> & { for: () => Promise<DeploymentRow[]> };
	promise.for = () => Promise.resolve(rows);
	return promise;
}

function selectChain() {
	return {
		from: () => ({
			where: () => ({
				limit: () => rowsThenable(currentRow ? [currentRow] : [])
			})
		})
	};
}

function makeTx() {
	return {
		select: () => selectChain(),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updateValues = values;
				return {
					where: () => ({
						returning: async () => {
							currentRow = { ...currentRow, ...values } as DeploymentRow;
							return [currentRow];
						}
					})
				};
			}
		}),
		insert: () => ({
			values: async (values: unknown) => {
				insertedLogs.push(values);
			}
		})
	};
}

mock.module('@kubwave/db', () => ({
	deployments: {
		id: 'id',
		serviceId: 'serviceId',
		status: 'status',
		phase: 'phase'
	},
	deploymentLogs: {},
	db: {
		select: () => selectChain(),
		transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx())
	}
}));

// Mock the ServicesService module so the real one (which imports many @kubwave/db tables) does
// not load; cancelDeployment only needs loadServiceForUser to authorize access.
mock.module('~/modules/services/services.service', () => ({
	ServicesService: class {
		async loadServiceForUser() {
			return { id: 'svc-1' };
		}
	}
}));

const { DeploymentsService } = await import('~/modules/deployments/deployments.service');

const services = { loadServiceForUser: async () => ({ id: 'svc-1' }) } as unknown as ServicesService;
const service = new DeploymentsService(services);

afterEach(() => {
	currentRow = row();
	updateValues = null;
	insertedLogs.length = 0;
});

describe('cancelDeployment', () => {
	test('deploying cancel preserves the active phase so the worker can distinguish build-only cancel from rollback', async () => {
		currentRow = row({ phase: 'building', rollbackAttempts: 2 });

		const result = await service.cancelDeployment('user-1', 'dep-1');

		expect(updateValues).toMatchObject({ status: 'canceling', lastError: null, rollbackAttempts: 0 });
		expect(updateValues).not.toHaveProperty('phase');
		expect(result.status).toBe('canceling');
		expect(result.phase).toBe('building');
		expect(insertedLogs).toHaveLength(1);
	});
});
