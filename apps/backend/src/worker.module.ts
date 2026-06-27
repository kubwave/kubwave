import { Module } from '@nestjs/common';
import { WorkerModule as WorkerRuntimeModule } from './modules/worker/worker.module.js';
import { SharedModule } from './shared/shared.module.js';

@Module({
	imports: [SharedModule, WorkerRuntimeModule]
})
export class WorkerModule {}
