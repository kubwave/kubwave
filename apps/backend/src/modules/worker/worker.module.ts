import { Module } from '@nestjs/common';
import { WorkerRuntimeService } from './worker-runtime.service.js';

@Module({
	providers: [WorkerRuntimeService],
	exports: [WorkerRuntimeService]
})
export class WorkerModule {}
