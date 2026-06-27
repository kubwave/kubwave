import { desc, eq } from 'drizzle-orm';
import { db, deployments, services } from '@kubwave/db';
import { env } from '../../../../shared/config/worker-env.js';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { BUILD_ACTIVE_STATUSES } from '../deployments/types.js';
import { registryAuthHeaders } from './auth.js';
import { BUILDKIT_CACHE_TAG } from '../deployments/builds/buildkit.js';

// Prunes superseded Dockerfile image tags via the registry v2 manifest API, keeping the running image, the last-succeeded rollback target, and in-flight refs.
// Only un-references blobs; disk is reclaimed by `registry garbage-collect` (gc.ts). Best-effort: any error skips and retries.

const MANIFEST_ACCEPT =
	'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json';

function registryBaseUrl(): string {
	const scheme = env.registryInsecure ? 'http' : 'https';
	return `${scheme}://${env.registryEndpoint}`;
}

// Registry repo for a service: env-<environmentId>/svc-<serviceId>. Mirrors buildImageRef.
export function serviceRepoPath(environmentId: string, serviceId: string): string {
	return `env-${environmentId}/svc-${serviceId}`;
}

export function selectTagsToDelete(registryTags: string[], keep: Set<string>): string[] {
	return registryTags.filter(tag => tag !== BUILDKIT_CACHE_TAG && !keep.has(tag));
}

async function listRepoTags(repo: string): Promise<string[]> {
	const url = `${registryBaseUrl()}/v2/${repo}/tags/list`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: await registryAuthHeaders() });
		if (!res.ok) return [];
		const body = (await res.json()) as { tags?: string[] | null };
		return body.tags ?? [];
	} catch {
		return [];
	}
}

async function resolveManifestDigest(repo: string, tag: string): Promise<string | null> {
	const url = `${registryBaseUrl()}/v2/${repo}/manifests/${tag}`;
	try {
		const res = await fetch(url, {
			method: 'HEAD',
			headers: { Accept: MANIFEST_ACCEPT, ...(await registryAuthHeaders()) },
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return null;
		return res.headers.get('docker-content-digest');
	} catch {
		return null;
	}
}

async function deleteManifest(repo: string, digest: string): Promise<boolean> {
	const url = `${registryBaseUrl()}/v2/${repo}/manifests/${digest}`;
	try {
		const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000), headers: await registryAuthHeaders() });
		return res.status === 202 || res.status === 404;
	} catch {
		return false;
	}
}

export async function pruneServiceRepo(environmentId: string, serviceId: string, keepTags: Set<string>): Promise<number> {
	const repo = serviceRepoPath(environmentId, serviceId);
	const tags = await listRepoTags(repo);
	const toDelete = selectTagsToDelete(tags, keepTags);
	let deleted = 0;
	for (const tag of toDelete) {
		const digest = await resolveManifestDigest(repo, tag);
		if (!digest) continue; // can't resolve -> skip; a later pass retries
		if (await deleteManifest(repo, digest)) deleted++;
	}
	return deleted;
}

export function computeKeepTags(rows: Array<{ id: string; status: string }>, keepSucceeded: number): Set<string> {
	const keep = new Set<string>();
	let succeededKept = 0;
	const activeSet = new Set<string>(BUILD_ACTIVE_STATUSES);
	for (const row of rows) {
		if (activeSet.has(row.status)) {
			keep.add(row.id);
		} else if (row.status === 'succeeded' && succeededKept < keepSucceeded) {
			keep.add(row.id);
			succeededKept++;
		}
	}
	return keep;
}

export async function pruneRegistryImages(): Promise<void> {
	if (!env.registryEndpoint) return;

	// All Dockerfile deployments joined to their environment, newest first; the inner join skips deleted services (orphaned repos go to the GC pass).
	const rows = await db
		.select({
			id: deployments.id,
			serviceId: deployments.serviceId,
			environmentId: services.environmentId,
			status: deployments.status
		})
		.from(deployments)
		.innerJoin(services, eq(deployments.serviceId, services.id))
		.where(eq(deployments.type, 'dockerfile'))
		.orderBy(desc(deployments.createdAt));

	const byService = new Map<string, { environmentId: string; rows: Array<{ id: string; status: string }> }>();
	for (const row of rows) {
		let group = byService.get(row.serviceId);
		if (!group) {
			group = { environmentId: row.environmentId, rows: [] };
			byService.set(row.serviceId, group);
		}
		group.rows.push({ id: row.id, status: row.status });
	}

	let totalDeleted = 0;
	for (const [serviceId, group] of byService) {
		const keep = computeKeepTags(group.rows, env.registryPruneKeep);
		try {
			totalDeleted += await pruneServiceRepo(group.environmentId, serviceId, keep);
		} catch (err) {
			console.warn(`[registry-prune] prune of svc ${serviceId} failed (will retry):`, errorMessage(err));
		}
	}

	if (totalDeleted > 0) console.log(`[registry-prune] deleted ${totalDeleted} superseded image tag(s)`);
}
