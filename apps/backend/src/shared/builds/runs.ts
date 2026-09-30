import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql, lt } from 'drizzle-orm';
import { db, buildRuns, buildAgents, deployments, type BuildRun } from '@kubwave/db';
import { encryptSecret } from '@kubwave/crypto';
import { AGENT_LEASE_SECONDS, type BuildPayload } from '@kubwave/build-protocol';
import { getBuildSettings } from './build-settings.service.js';
import { agentAvailable, attemptImageRef, applyBuildResources } from './execution.js';
import { BuildArtifacts } from './artifacts.js';
import type { CoreV1Api } from '@kubernetes/client-node';

export const ACTIVE_BUILD_STATES = ['preparing', 'ready', 'running'] as const;

export async function getBuildRun(deploymentId: string): Promise<BuildRun | null> {
	const [row] = await db.select().from(buildRuns).where(eq(buildRuns.deploymentId, deploymentId)).limit(1);
	return row ?? null;
}

export async function ensureBuildRun(deploymentId: string): Promise<BuildRun> {
	const settings = await getBuildSettings();
	await db.insert(buildRuns).values({ id: randomUUID(), deploymentId, settings, execution: settings.execution }).onConflictDoNothing();
	return (await getBuildRun(deploymentId))!;
}

export async function reserveBuildRun(run: BuildRun, architecture: string): Promise<BuildRun | null> {
	return db.transaction(async tx => {
		await tx.execute(sql`select pg_advisory_xact_lock(73162411)`);
		const [current] = await tx.select().from(buildRuns).where(eq(buildRuns.id, run.id)).for('update');
		if (!current || current.status !== 'queued') return null;
		const liveSettings = await getBuildSettings();
		const active = await tx
			.select()
			.from(buildRuns)
			.where(inArray(buildRuns.status, [...ACTIVE_BUILD_STATES]));
		let agentId: string | null = null;
		let execution = current.execution;
		if (execution === 'agent') {
			const agents = (await tx.select().from(buildAgents)).filter(agent => agentAvailable(agent, architecture));
			const occupancy = (id: string) => active.filter(build => build.agentId === id).length;
			agents.sort((a, b) => occupancy(a.id) / a.maxConcurrentBuilds - occupancy(b.id) / b.maxConcurrentBuilds);
			agentId = agents.find(agent => occupancy(agent.id) < agent.maxConcurrentBuilds)?.id ?? null;
			if (!agentId) {
				if (current.attempt > 1 || !current.settings.fallbackToCluster || Date.now() - current.createdAt.getTime() < AGENT_LEASE_SECONDS * 1000)
					return null;
				execution = 'cluster';
			}
		}
		if (execution === 'cluster' && active.filter(build => build.execution === 'cluster').length >= liveSettings.maxConcurrentBuilds) return null;
		const [reserved] = await tx
			.update(buildRuns)
			.set({
				status: 'preparing',
				execution,
				agentId,
				leaseExpiresAt: new Date(Date.now() + AGENT_LEASE_SECONDS * 1000)
			})
			.where(eq(buildRuns.id, current.id))
			.returning();
		return reserved ?? null;
	});
}

export async function markClusterBuildStarted(run: BuildRun, imageRef: string): Promise<void> {
	await db
		.update(buildRuns)
		.set({ status: 'running', imageRef, startedAt: new Date(), leaseExpiresAt: null })
		.where(and(eq(buildRuns.id, run.id), eq(buildRuns.status, 'preparing')));
}

export async function finishBuildRun(run: BuildRun, status: 'succeeded' | 'failed', lastError: string | null = null): Promise<void> {
	await db
		.update(buildRuns)
		.set({ status, lastError, finishedAt: new Date(), payloadCiphertext: null, leaseTokenHash: null })
		.where(and(eq(buildRuns.id, run.id), inArray(buildRuns.status, [...ACTIVE_BUILD_STATES])));
}

export async function publishAgentBuild(run: BuildRun, artifacts: BuildArtifacts, coreApi: CoreV1Api, baseImageRef: string): Promise<void> {
	const job = artifacts.job;
	if (!job) throw new Error('No build job was prepared');
	applyBuildResources(job, run.settings);
	const builder = job.spec!.template.spec!.containers.find(container => container.name === 'builder');
	if (run.sourceCommit) {
		const prepare = job.spec!.template.spec!.initContainers?.find(container => container.name === 'prepare');
		if (prepare)
			prepare.env = [...(prepare.env ?? []).filter(entry => entry.name !== 'SOURCE_COMMIT'), { name: 'SOURCE_COMMIT', value: run.sourceCommit }];
	}
	const exportCache = builder?.args?.indexOf('--export-cache') ?? -1;
	if (builder?.args && exportCache >= 0)
		builder.args[exportCache + 1] = builder.args[exportCache + 1]!.replace(',mode=max', `-${run.id}-${run.attempt},mode=max`);
	const files: BuildPayload['files'] = {};
	const redactions: string[] = [];
	for (const volume of job.spec!.template.spec!.volumes ?? []) {
		files[volume.name] = {};
		if (volume.configMap) {
			const cm = artifacts.configMaps.get(volume.configMap.name!);
			if (!cm) throw new Error('Build config is missing');
			for (const item of volume.configMap.items ?? []) files[volume.name]![item.path] = cm.data?.[item.key] ?? '';
		}
		if (volume.secret) {
			const secret =
				artifacts.secrets.get(volume.secret.secretName!) ??
				(await coreApi.readNamespacedSecret({ namespace: job.metadata?.namespace ?? 'kubwave', name: volume.secret.secretName! }));
			for (const item of volume.secret.items ?? []) {
				const value = secret.stringData?.[item.key] ?? Buffer.from(secret.data?.[item.key] ?? '', 'base64').toString();
				if (!value) throw new Error(`Build credential ${item.key} is missing`);
				files[volume.name]![item.path] = value;
				redactions.push(value);
				if (item.key === 'extraheader') redactions.push(value.replace(/^Authorization:\s*/i, ''));
				if (item.key === '.dockerconfigjson') {
					const auths = (JSON.parse(value) as { auths?: Record<string, { auth?: string; password?: string }> }).auths ?? {};
					for (const auth of Object.values(auths)) {
						if (auth.auth) redactions.push(auth.auth, Buffer.from(auth.auth, 'base64').toString().split(':').slice(1).join(':'));
						if (auth.password) redactions.push(auth.password);
					}
				}
			}
		}
	}
	const payload: BuildPayload = { job, files, redactions, imageRef: attemptImageRef(baseImageRef, run.id, run.attempt) };
	await db
		.update(buildRuns)
		.set({ status: 'ready', payloadCiphertext: encryptSecret(JSON.stringify(payload)), imageRef: payload.imageRef })
		.where(and(eq(buildRuns.id, run.id), eq(buildRuns.status, 'preparing'), eq(buildRuns.attempt, run.attempt)));
}

export async function cancelBuildRun(deploymentId: string): Promise<boolean> {
	const updated = await db
		.update(buildRuns)
		.set({ status: 'canceled', finishedAt: new Date(), payloadCiphertext: null, leaseTokenHash: null })
		.where(and(eq(buildRuns.deploymentId, deploymentId), inArray(buildRuns.status, ['queued', ...ACTIVE_BUILD_STATES])))
		.returning();
	return updated.length > 0;
}

export async function maintainBuildRuns(): Promise<void> {
	const runs = await db
		.select()
		.from(buildRuns)
		.where(inArray(buildRuns.status, ['queued', ...ACTIVE_BUILD_STATES]));
	for (const run of runs) {
		const [deployment] = await db.select({ status: deployments.status }).from(deployments).where(eq(deployments.id, run.deploymentId));
		if (deployment?.status === 'canceling') continue;
		if (!deployment || !['pending', 'deploying'].includes(deployment.status)) {
			await cancelBuildRun(run.deploymentId);
			continue;
		}
		if (run.status === 'queued' && Date.now() - run.createdAt.getTime() > run.settings.queueTimeoutSeconds * 1000) {
			await db
				.update(buildRuns)
				.set({ status: 'failed', lastError: 'Build queue timeout: no capacity became available.', finishedAt: new Date() })
				.where(and(eq(buildRuns.id, run.id), eq(buildRuns.status, 'queued')));
			continue;
		}
		const expiredLease = run.leaseExpiresAt && run.leaseExpiresAt.getTime() < Date.now();
		const timedOut = run.startedAt && Date.now() - run.startedAt.getTime() > run.settings.timeoutSeconds * 1000;
		if (!expiredLease && !timedOut) continue;
		const retry = expiredLease && !timedOut && run.attempt < 2;
		await db
			.update(buildRuns)
			.set({
				status: retry ? 'queued' : 'failed',
				attempt: retry ? run.attempt + 1 : run.attempt,
				agentId: null,
				leaseTokenHash: null,
				leaseExpiresAt: null,
				payloadCiphertext: null,
				startedAt: null,
				lastError: retry ? null : timedOut ? 'Build exceeded its timeout.' : 'Build server lease expired.',
				finishedAt: retry ? null : new Date()
			})
			.where(
				and(
					eq(buildRuns.id, run.id),
					eq(buildRuns.status, run.status),
					eq(buildRuns.attempt, run.attempt),
					...(expiredLease ? [lt(buildRuns.leaseExpiresAt, new Date())] : [])
				)
			);
	}
}
