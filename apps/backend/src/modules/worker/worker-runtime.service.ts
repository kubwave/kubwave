import { Injectable } from '@nestjs/common';
import type { Server } from 'node:http';
import { BackendConfigService } from '../../shared/config/backend-config.service.js';
import { startWorkerHealthServer } from './health-server.js';
import { createWorkerJobs } from './jobs/index.js';
import { runStartupChecks } from './jobs/startup-checks.js';
import type { IntervalJob } from '../../shared/scheduler/interval-job.js';

@Injectable()
export class WorkerRuntimeService {
	private health: Server | null = null;
	private jobs: IntervalJob[] = [];

	constructor(private readonly config: BackendConfigService) {}

	async start(): Promise<void> {
		const worker = this.config.worker;
		console.log(`[backend:worker] starting (workerId=${worker.workerId}, reconcileInterval=${worker.reconcileIntervalMs}ms)`);

		this.health = startWorkerHealthServer(worker.healthPort);
		console.log(`[backend:worker] health endpoint listening on :${worker.healthPort}`);

		this.jobs = createWorkerJobs();
		runStartupChecks();
	}

	async stop(): Promise<void> {
		for (const job of this.jobs) job.stop();
		this.jobs = [];
		if (!this.health) return;
		await new Promise<void>((resolve, reject) => {
			this.health?.close(err => (err ? reject(err) : resolve()));
		});
		this.health = null;
	}
}
