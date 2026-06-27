import 'reflect-metadata';
import { sql } from '@kubwave/db';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { WorkerRuntimeService } from './modules/worker/worker-runtime.service.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
const worker = app.get(WorkerRuntimeService);

await worker.start();

async function shutdown(signal: string): Promise<void> {
	console.log(`[backend:worker] ${signal} received, shutting down`);
	await worker.stop();
	await app.close();
	await sql.end({ timeout: 5 }).catch(() => {});
	process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
