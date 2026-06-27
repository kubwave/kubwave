import { Injectable } from '@nestjs/common';
import { CoreV1Api } from '@kubernetes/client-node';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, updateRuns, type UpdateRun } from '@kubwave/db';
import { getKubeConfig } from '@kubwave/kube';
import { BackendConfigService } from '../../../shared/config/backend-config.service.js';
import { SettingsService } from '../../../shared/settings/settings.service.js';
import { PlatformVersionService, PLATFORM_VERSION_KEY } from '../version/platform-version.service.js';
import type { VersionState } from '../version/platform-version.dto.js';
import { planContainerLogs } from './logs/update-log-planner.js';
import { UpdateConcurrentError, UpdateInvalidTargetVersionError, UpdateRunNotFoundError } from './platform-updates.errors.js';
import type { UpdateRunDto } from './platform-updates.dto.js';

const ACTIVE_UPDATE_RUN_STATUSES = ['pending', 'running'];

function serializeUpdateRun(run: UpdateRun): UpdateRunDto {
	return {
		id: run.id,
		fromVersion: run.fromVersion,
		toVersion: run.toVersion,
		status: run.status,
		startedAt: run.startedAt?.toISOString() ?? null,
		finishedAt: run.finishedAt?.toISOString() ?? null,
		phase: run.phase,
		lastError: run.lastError,
		jobName: run.jobName,
		oldImageTags: (run.oldImageTags as Record<string, string> | null) ?? null,
		triggeredByUserId: run.triggeredByUserId,
		createdAt: run.createdAt.toISOString()
	};
}

@Injectable()
export class PlatformUpdatesService {
	constructor(
		private readonly config: BackendConfigService,
		private readonly settings: SettingsService,
		private readonly version: PlatformVersionService
	) {}

	async listUpdateRuns(): Promise<UpdateRunDto[]> {
		const runs = await db.select().from(updateRuns).orderBy(desc(updateRuns.createdAt)).limit(20);
		return runs.map(serializeUpdateRun);
	}

	async getUpdateRun(id: string): Promise<UpdateRunDto> {
		const [run] = await db.select().from(updateRuns).where(eq(updateRuns.id, id)).limit(1);
		if (!run) throw new UpdateRunNotFoundError();
		return serializeUpdateRun(run);
	}

	async triggerUpdate(targetVersion: string, userId: string): Promise<UpdateRunDto> {
		const activeRuns = await db.select({ id: updateRuns.id }).from(updateRuns).where(inArray(updateRuns.status, ACTIVE_UPDATE_RUN_STATUSES)).limit(1);
		if (activeRuns[0]) throw new UpdateConcurrentError();

		const versionState = await this.settings.get<VersionState>(PLATFORM_VERSION_KEY);
		const available = versionState?.availableVersions ?? [];
		if (!available.some(version => version.version === targetVersion)) throw new UpdateInvalidTargetVersionError(targetVersion);

		const currentVersion = this.version.getInstalledVersion();
		if (currentVersion && currentVersion === targetVersion) {
			const now = new Date();
			const [noop] = await db
				.insert(updateRuns)
				.values({
					fromVersion: currentVersion,
					toVersion: targetVersion,
					status: 'succeeded',
					phase: 'done',
					startedAt: now,
					finishedAt: now,
					triggeredByUserId: userId
				})
				.returning();

			if (!noop) throw new Error('failed to create update run');
			return serializeUpdateRun(noop);
		}

		try {
			const [created] = await db
				.insert(updateRuns)
				.values({ fromVersion: currentVersion, toVersion: targetVersion, status: 'pending', triggeredByUserId: userId })
				.returning();

			if (!created) throw new Error('failed to create update run');
			return serializeUpdateRun(created);
		} catch (err) {
			if (isUniqueViolation(err)) throw new UpdateConcurrentError();
			throw err;
		}
	}

	async getJobLogs(runId: string): Promise<string> {
		const [run] = await db.select().from(updateRuns).where(eq(updateRuns.id, runId)).limit(1);
		if (!run) throw new UpdateRunNotFoundError();
		if (!run.jobName) return 'No job associated with this update run.';

		const coreApi = getKubeConfig().makeApiClient(CoreV1Api);
		const namespace = this.config.api.podNamespace;
		const podList = await coreApi.listNamespacedPod({ namespace, labelSelector: `job-name=${run.jobName}` });
		const pod = podList.items[0];
		if (!pod?.metadata?.name) return 'No pod found for this job yet.';

		const podName = pod.metadata.name;
		const targets = planContainerLogs(pod);
		if (targets.length <= 1) {
			if (targets[0] && !targets[0].readable) return 'No logs available for this job yet.';
			const logs = await coreApi.readNamespacedPodLog({ name: podName, namespace, ...(targets[0] ? { container: targets[0].name } : {}) });
			return typeof logs === 'string' ? logs : String(logs);
		}

		const failed = targets.filter(target => target.failed);
		const selected = (failed.length > 0 ? failed : targets).filter(target => target.readable);
		if (selected.length === 0) return 'No container logs available yet.';

		const sections: string[] = [];
		for (const target of selected) {
			const header = target.failed ? `=== ${target.name} (failed: ${target.reason}) ===` : `=== ${target.name} ===`;
			try {
				const logs = await coreApi.readNamespacedPodLog({ name: podName, namespace, container: target.name });
				sections.push(`${header}\n${typeof logs === 'string' ? logs : String(logs)}`);
			} catch (err) {
				sections.push(`${header}\n(logs unavailable: ${err instanceof Error ? err.message : String(err)})`);
			}
		}

		return sections.join('\n\n');
	}
}

function isUniqueViolation(err: unknown): boolean {
	return !!err && typeof err === 'object' && (err as { code?: unknown }).code === '23505';
}
