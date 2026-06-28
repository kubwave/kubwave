import { afterEach, describe, expect, mock, test } from 'bun:test';

const usersTable = { id: 'id', email: 'email', password: 'password' };
const resetTable = { id: 'id', userId: 'userId', tokenHash: 'tokenHash', expiresAt: 'expiresAt', usedAt: 'usedAt' };
const refreshTable = { userId: 'userId', revokedAt: 'revokedAt' };

let selectResults = new Map<unknown, unknown[]>();
let inserted: Array<{ table: unknown; values: any }> = [];
let deleted: Array<{ table: unknown }> = [];
let txUpdates: Array<{ table: unknown; values: any }> = [];
let failNextInsert = false;

function selectChain() {
	let table: unknown;
	const chain: any = {
		from(t: unknown) {
			table = t;
			return chain;
		},
		where() {
			return chain;
		},
		async limit() {
			return selectResults.get(table) ?? [];
		}
	};
	return chain;
}

mock.module('@kubwave/db', () => {
	const deleteImpl = (table: unknown) => ({
		async where() {
			deleted.push({ table });
		}
	});
	const insertImpl = (table: unknown) => ({
		async values(values: any) {
			if (failNextInsert) {
				failNextInsert = false;
				throw new Error('DB connection lost');
			}
			inserted.push({ table, values });
		}
	});
	const updateImpl = (table: unknown) => {
		let values: any;
		const chain: any = {
			set(v: any) {
				values = v;
				return chain;
			},
			async where() {
				txUpdates.push({ table, values });
			}
		};
		return chain;
	};
	return {
		users: usersTable,
		passwordResetTokens: resetTable,
		refreshTokens: refreshTable,
		teams: {},
		teamMembers: {},
		settings: {},
		db: {
			select: () => selectChain(),
			delete: deleteImpl,
			insert: insertImpl,
			transaction: async (fn: (tx: any) => Promise<unknown>) => {
				return await fn({ delete: deleteImpl, insert: insertImpl, update: updateImpl });
			}
		}
	};
});

const { AuthService } = await import('~/modules/auth/auth.service');

function makeService(mailerImpl?: () => Promise<string>) {
	const config = { api: { appBaseUrl: 'http://console.test' } } as any;
	const passwords = { hash: async () => 'hashed-pw', verify: async () => true } as any;
	const teams = {} as any;
	const tokens = { generateRefreshToken: () => 'raw-token', hashRefreshToken: (t: string) => `hash:${t}` } as any;
	const sendPasswordResetEmail = mock(mailerImpl ?? (async () => 'msg-id'));
	const mailer = { sendPasswordResetEmail } as any;
	const service = new AuthService(config, passwords, teams, tokens, mailer);
	return { service, sendPasswordResetEmail };
}

afterEach(() => {
	selectResults = new Map();
	inserted = [];
	deleted = [];
	txUpdates = [];
	failNextInsert = false;
});

describe('requestPasswordReset', () => {
	test('unknown email: no token, no email', async () => {
		selectResults.set(usersTable, []);
		const { service, sendPasswordResetEmail } = makeService();
		await service.requestPasswordReset('ghost@example.com');
		expect(inserted).toHaveLength(0);
		expect(sendPasswordResetEmail).not.toHaveBeenCalled();
	});

	test('known email: inserts a hashed token and emails a reset URL', async () => {
		selectResults.set(usersTable, [{ id: 'u1', email: 'user@x.test' }]);
		const { service, sendPasswordResetEmail } = makeService();
		await service.requestPasswordReset('user@x.test');
		expect(inserted).toHaveLength(1);
		expect(inserted[0]!.values.userId).toBe('u1');
		expect(inserted[0]!.values.tokenHash).toBe('hash:raw-token');
		expect(deleted.some(d => d.table === resetTable)).toBe(true);
		expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
		const arg = (sendPasswordResetEmail.mock.calls[0] as unknown as [{ to: string; resetUrl: string }])[0];
		expect(arg.to).toBe('user@x.test');
		expect(arg.resetUrl).toBe('http://console.test/auth/reset?token=raw-token');
	});

	test('mailer failure is swallowed (no throw)', async () => {
		selectResults.set(usersTable, [{ id: 'u1', email: 'user@x.test' }]);
		const { service } = makeService(async () => {
			throw new Error('SMTP disabled');
		});
		await expect(service.requestPasswordReset('user@x.test')).resolves.toBeUndefined();
	});

	test('infra error (DB insert failure) is swallowed and does not throw', async () => {
		selectResults.set(usersTable, [{ id: 'u1', email: 'user@x.test' }]);
		failNextInsert = true;
		const { service } = makeService();
		await expect(service.requestPasswordReset('user@x.test')).resolves.toBeUndefined();
	});
});

describe('resetPassword', () => {
	test('valid token: updates password, marks used, revokes refresh tokens', async () => {
		selectResults.set(resetTable, [{ id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 60_000) }]);
		const { service } = makeService();
		await service.resetPassword('raw-token', 'a-brand-new-password');
		expect(txUpdates).toHaveLength(3);
		expect(txUpdates.find(u => u.table === usersTable)!.values.password).toBe('hashed-pw');
		expect(txUpdates.some(u => u.table === resetTable && u.values.usedAt instanceof Date)).toBe(true);
		expect(txUpdates.some(u => u.table === refreshTable && u.values.revokedAt instanceof Date)).toBe(true);
	});

	test('expired token: throws invalid_reset_token', async () => {
		selectResults.set(resetTable, [{ id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() - 1000) }]);
		const { service } = makeService();
		await expect(service.resetPassword('raw-token', 'a-brand-new-password')).rejects.toMatchObject({ code: 'invalid_reset_token' });
		expect(txUpdates).toHaveLength(0);
	});

	test('already-used token: throws invalid_reset_token', async () => {
		selectResults.set(resetTable, [{ id: 't1', userId: 'u1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }]);
		const { service } = makeService();
		await expect(service.resetPassword('raw-token', 'a-brand-new-password')).rejects.toMatchObject({ code: 'invalid_reset_token' });
		expect(txUpdates).toHaveLength(0);
	});

	test('unknown token: throws invalid_reset_token', async () => {
		selectResults.set(resetTable, []);
		const { service } = makeService();
		await expect(service.resetPassword('raw-token', 'a-brand-new-password')).rejects.toMatchObject({ code: 'invalid_reset_token' });
	});
});
