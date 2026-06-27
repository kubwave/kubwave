import type { NestFastifyApplication } from '@nestjs/platform-fastify';

// Listen (pod ready via DB-independent /api/health) before any DB work, so migrations can run
// in the background — a rolling upgrade must not deadlock on a briefly-unreachable Postgres.
export interface ApiBootDeps {
	createApp: () => Promise<NestFastifyApplication>;
	resolvePort: (app: NestFastifyApplication) => number;
	listen: (app: NestFastifyApplication, port: number) => Promise<void>;
	runMigrations: () => Promise<void>;
	startNotifications: () => void;
	onReady?: (port: number) => void;
	onMigrationError?: (err: unknown) => void;
}

export async function bootApi(deps: ApiBootDeps): Promise<NestFastifyApplication> {
	const app = await deps.createApp();
	const port = deps.resolvePort(app);

	await deps.listen(app, port);
	deps.onReady?.(port);

	void deps
		.runMigrations()
		.then(() => deps.startNotifications())
		.catch(err => {
			if (deps.onMigrationError) deps.onMigrationError(err);
			else throw err;
		});

	return app;
}
