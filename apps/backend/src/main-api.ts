import 'reflect-metadata';
import { sql } from '@kubwave/db';
import { bootApi } from './api-boot.js';
import { createApiApp } from './app.factory.js';
import { startFlowLayoutNotifications } from './modules/environments/flow-layout/flow-layout.realtime.js';
import { BackendConfigService } from './shared/config/backend-config.service.js';
import { runBootMigrationsWithRetry } from './shared/db/migrations.js';

// Listen first (readiness via DB-independent /api/health), then migrate in the
// background. Keeps a transient DB outage during a rolling upgrade from blocking
// readiness and failing the atomic helm upgrade. See api-boot.ts for the rationale.
const app = await bootApi({
	createApp: createApiApp,
	resolvePort: instance => instance.get(BackendConfigService).api.port,
	listen: async (instance, port) => {
		await instance.listen(port, '0.0.0.0');
	},
	runMigrations: runBootMigrationsWithRetry,
	startNotifications: startFlowLayoutNotifications,
	onReady: port => console.log(`[backend:api] listening on :${port}`),
	onMigrationError: err => {
		console.error('[backend:api] boot migrations failed after retries; exiting', err);
		process.exit(1);
	}
});

async function shutdown(signal: string): Promise<void> {
	console.log(`[backend:api] ${signal} received, shutting down`);
	await app.close();
	await sql.end({ timeout: 5 }).catch(() => {});
	process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
