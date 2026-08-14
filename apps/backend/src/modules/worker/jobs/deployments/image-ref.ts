import { and, eq, isNull } from 'drizzle-orm';
import type { RegistryAuthConfig } from '@kubwave/db';
import { errorMessage } from '../../../../shared/worker-common/errors.js';
import { parseImageRef, resolveTagDigest } from '../registry-tag-watch/registry.js';

// Write-once: a deployment's image ref is decided on its first reconcile tick, and every later tick reuses it.
// The db import stays lazy so pulling this in never forces a connection at module load.
export async function persistDeploymentImageRef(deploymentId: string, imageRef: string): Promise<void> {
	const { db, deployments } = await import('@kubwave/db');
	await db
		.update(deployments)
		.set({ imageRef })
		.where(and(eq(deployments.id, deploymentId), isNull(deployments.imageRef)));
}

export interface PinnedImageRef {
	ref: string;
	pinned: boolean;
}

// Resolve a moving tag to a digest so the pod runs an immutable ref: the node cache is then correct by construction and
// a republished tag still produces a new ref, which is what makes a redeploy actually roll.
// Resolution happens exactly once per deployment - the outcome is recorded either way, because reconcileInFlight walks
// its rows sequentially and a retry on every tick would stall every other in-flight deployment behind this one.
export async function resolveDeploymentImageRef(args: {
	deploymentId: string;
	recordedRef?: string | null;
	image: string;
	tag: string;
	registryAuth?: RegistryAuthConfig;
	label: string;
}): Promise<PinnedImageRef> {
	const recorded = args.recordedRef?.trim();
	if (recorded) return { ref: recorded, pinned: recorded.includes('@') };

	const tagRef = `${args.image}:${args.tag}`;
	let digest: string | null = null;
	try {
		digest = await resolveTagDigest(parseImageRef(args.image, args.tag), args.registryAuth);
		// A 404 means the tag is simply not published; without this it would fall back indistinguishably from an outage.
		if (!digest) console.warn(`[deploy] ${args.label}: deploying ${tagRef} unpinned, tag not found in the registry`);
	} catch (err) {
		console.warn(`[deploy] ${args.label}: deploying ${tagRef} unpinned, digest resolution failed:`, errorMessage(err));
	}

	const ref = digest ? `${args.image}@${digest}` : tagRef;
	await persistDeploymentImageRef(args.deploymentId, ref);
	return { ref, pinned: digest != null };
}
