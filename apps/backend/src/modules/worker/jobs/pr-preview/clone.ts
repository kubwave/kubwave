import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { buildDefaultDomainForService, db, deploymentLogs, deployments, environments, services, type Environment } from '@kubwave/db';
import { environmentNamespace } from '@kubwave/kube';
import { planPreviewServices, deployablePreviewRows } from './clone-plan.js';
import type { OpenPr } from './providers.js';
import { getDefaultDomainRuntime, getDefaultDomainSettings } from '../../../../shared/cluster/default-domain.js';
import { deploymentLogRows, logEntry } from '../deployments/logs.js';

const NO_PREVIEW_HOST_MESSAGE =
	'This service is public in the base environment, but the preview got no URL: the platform default domain is off or unresolved (or the service has no container port). Env values referencing its base hosts were left unchanged.';

function slug(repoUrl: string): string {
	const tail =
		repoUrl
			.replace(/\.git$/, '')
			.split(/[/:]/)
			.pop() ?? 'repo';
	return (
		tail
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '-')
			.slice(0, 30) || 'repo'
	);
}

async function loadDefaultDomainResolver(): Promise<(service: { serviceId: string; serviceName: string }) => string | null> {
	const [settings, runtime] = await Promise.all([getDefaultDomainSettings(), getDefaultDomainRuntime()]);
	return service => buildDefaultDomainForService(settings, runtime, service);
}

// Clone `base` into a new preview environment for `pr`: inserts the env, copied service rows, and a
// pending preview-trigger deployment per service. Idempotent against the unique (base_environment_id,
// pr_repo_url, pr_number) index - a duplicate insert throws and the caller skips it.
export async function clonePreview(base: Environment, pr: OpenPr, prRepoUrl: string): Promise<void> {
	const previewEnvironmentId = randomUUID();
	const baseServices = await db.select().from(services).where(eq(services.environmentId, base.id));
	const baseIds = baseServices.map(s => s.id);
	const succeeded = baseIds.length
		? await db
				.select({ serviceId: deployments.serviceId })
				.from(deployments)
				.where(and(inArray(deployments.serviceId, baseIds), eq(deployments.status, 'succeeded')))
		: [];
	const deployedBaseIds = new Set(succeeded.map(r => r.serviceId));
	const defaultDomainHost = await loadDefaultDomainResolver();

	const plan = planPreviewServices(baseServices, {
		previewEnvironmentId,
		baseNamespace: environmentNamespace(base.id),
		previewNamespace: environmentNamespace(previewEnvironmentId),
		prRepoUrl,
		prRef: pr.prRef,
		headSha: pr.headSha,
		defaultDomainHost,
		newId: randomUUID
	});
	if (plan.noPreviewHost.size > 0) {
		console.warn(
			`[pr-discovery] PR #${pr.prNumber} preview of env ${base.id}: ${plan.noPreviewHost.size} public service(s) got no preview URL (platform default domain off or unresolved)`
		);
	}

	await db.transaction(async tx => {
		await tx.insert(environments).values({
			id: previewEnvironmentId,
			projectId: base.projectId,
			name: `pr-${pr.prNumber}-${slug(prRepoUrl)}`,
			kind: 'preview',
			prPreviewsEnabled: false,
			baseEnvironmentId: base.id,
			prNumber: pr.prNumber,
			prRepoUrl,
			prRef: pr.prRef
		});
		if (plan.services.length > 0) {
			await tx.insert(services).values(plan.services);
			const deployRows = deployablePreviewRows(baseServices, plan.services, deployedBaseIds, prRepoUrl);
			if (deployRows.length > 0) {
				const rows = await tx
					.insert(deployments)
					.values(
						deployRows.map(s => ({
							serviceId: s.id,
							type: s.type,
							config: s.config,
							status: 'pending' as const,
							trigger: 'preview' as const,
							triggeredByUserId: null
						}))
					)
					.returning({ id: deployments.id, serviceId: deployments.serviceId });
				if (rows.length > 0) {
					await tx
						.insert(deploymentLogs)
						.values(
							rows.flatMap(row =>
								deploymentLogRows(row.id, [
									logEntry('info', 'queued', `PR #${pr.prNumber} preview`),
									...(plan.noPreviewHost.has(row.serviceId) ? [logEntry('warn', 'preview-domain', NO_PREVIEW_HOST_MESSAGE)] : [])
								])
							)
						);
				}
			}
		}
	});
}
