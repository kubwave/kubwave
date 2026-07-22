import { Injectable } from '@nestjs/common';
import { DEFAULT_TCP_PORT_POOL, TCP_PORT_POOL_SETTINGS_KEY, resolveTcpPortPoolSettings, type TcpPortPoolSettings } from '@kubwave/kube';
import { db, servicePortExposures, settings, updateRuns } from '@kubwave/db';
import { asc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { ApiError } from '../../../../shared/errors/api-error.js';
import { UpdateConcurrentError } from '../../updates/platform-updates.errors.js';
import { serializeUpdateRun } from '../../updates/platform-updates.service.js';
import { PlatformVersionService } from '../../version/platform-version.service.js';
import type { TcpPortPoolSettingsDto, TcpPortPoolSettingsInput, TcpPortPoolSettingsUpdateDto } from './platform-tcp-port-pool-settings.dto.js';
import { tcpPortPoolConflicts } from './tcp-port-pool.rules.js';

@Injectable()
export class PlatformTcpPortPoolSettingsService {
	constructor(private readonly version: PlatformVersionService) {}

	async getSettings(): Promise<TcpPortPoolSettingsDto> {
		const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, TCP_PORT_POOL_SETTINGS_KEY)).limit(1);
		return resolveTcpPortPoolSettings(row?.value as Partial<TcpPortPoolSettings> | null, DEFAULT_TCP_PORT_POOL);
	}

	async updateSettings(input: TcpPortPoolSettingsInput, userId: string): Promise<TcpPortPoolSettingsUpdateDto> {
		try {
			const updateRun = await db.transaction(async tx => {
				const activeRuns = await tx
					.select({ id: updateRuns.id })
					.from(updateRuns)
					.where(inArray(updateRuns.status, ['pending', 'running']))
					.limit(1);
				if (activeRuns[0]) throw new UpdateConcurrentError();

				const conflicts = await this.findConflictingPorts(input, tx);
				if (conflicts.length > 0) {
					throw new ApiError(409, 'tcp_port_pool_conflict', { publicPorts: conflicts });
				}

				await tx
					.insert(settings)
					.values({ key: TCP_PORT_POOL_SETTINGS_KEY, value: input })
					.onConflictDoUpdate({ target: settings.key, set: { value: input, updatedAt: new Date() } });

				const version = this.version.getInstalledVersion();
				const [created] = await tx
					.insert(updateRuns)
					.values({ kind: 'tcp_port_pool', fromVersion: version, toVersion: version, status: 'pending', triggeredByUserId: userId })
					.returning();
				if (!created) throw new Error('failed to create TCP port pool reconcile run');
				return created;
			});

			return { ...input, updateRun: serializeUpdateRun(updateRun) };
		} catch (err) {
			if (isUniqueViolation(err)) throw new UpdateConcurrentError();
			throw err;
		}
	}

	private async findConflictingPorts(pool: TcpPortPoolSettings, database: Pick<typeof db, 'select'> = db): Promise<number[]> {
		const end = pool.start + pool.size - 1;
		const query = database.select({ publicPort: servicePortExposures.publicPort }).from(servicePortExposures);
		const rows = pool.enabled
			? await query
					.where(or(lt(servicePortExposures.publicPort, pool.start), gt(servicePortExposures.publicPort, end)))
					.orderBy(asc(servicePortExposures.publicPort))
			: await query.orderBy(asc(servicePortExposures.publicPort));
		return tcpPortPoolConflicts(
			pool,
			rows.map(row => row.publicPort)
		);
	}
}

function isUniqueViolation(err: unknown): boolean {
	return !!err && typeof err === 'object' && (err as { code?: unknown }).code === '23505';
}
