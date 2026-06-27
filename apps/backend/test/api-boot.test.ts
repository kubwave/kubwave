import { describe, expect, test } from 'bun:test';
import { bootApi, type ApiBootDeps } from '~/api-boot';

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

function baseDeps(overrides: Partial<ApiBootDeps> = {}): ApiBootDeps {
	return {
		createApp: async () => ({}) as never,
		resolvePort: () => 3001,
		listen: async () => {},
		runMigrations: async () => {},
		startNotifications: () => {},
		...overrides
	};
}

describe('bootApi', () => {
	// A transient DB outage must not block the api from listening, or the atomic helm upgrade times out and rolls back.
	test('listens without waiting for migrations to finish', async () => {
		let listened = false;
		let migrationsStarted = false;
		const deps = baseDeps({
			listen: async () => {
				listened = true;
			},
			// Never resolves — simulates the DB being unreachable for the whole window.
			runMigrations: () => {
				migrationsStarted = true;
				return new Promise<void>(() => {});
			}
		});

		await bootApi(deps);

		expect(listened).toBe(true);
		expect(migrationsStarted).toBe(true);
	});

	test('migrations run in the background after the server is listening', async () => {
		const order: string[] = [];
		const deps = baseDeps({
			listen: async () => {
				order.push('listen');
			},
			runMigrations: async () => {
				order.push('migrate');
			}
		});

		await bootApi(deps);
		await tick();

		expect(order).toEqual(['listen', 'migrate']);
	});

	test('starts realtime notifications only after migrations succeed', async () => {
		let notificationsStarted = false;
		const deps = baseDeps({
			startNotifications: () => {
				notificationsStarted = true;
			}
		});

		await bootApi(deps);
		await tick();

		expect(notificationsStarted).toBe(true);
	});

	test('reports migration failure and does not start notifications', async () => {
		const boom = new Error('database unreachable');
		let reported: unknown;
		let notificationsStarted = false;
		const deps = baseDeps({
			runMigrations: async () => {
				throw boom;
			},
			startNotifications: () => {
				notificationsStarted = true;
			},
			onMigrationError: err => {
				reported = err;
			}
		});

		await bootApi(deps);
		await tick();

		expect(reported).toBe(boom);
		expect(notificationsStarted).toBe(false);
	});
});
