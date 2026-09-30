import { env } from '../config/worker-env.js';
import { registryAuthHeaders } from '../../modules/worker/jobs/registry/auth.js';

const ACCEPT =
	'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.buildkit.cacheconfig.v0';

function manifestUrl(ref: string): string {
	const slash = ref.indexOf('/');
	const colon = ref.lastIndexOf(':');
	if (slash < 0 || colon < slash) throw new Error('Invalid build image reference');
	return `${env.registryInsecure ? 'http' : 'https'}://${ref.slice(0, slash)}/v2/${ref.slice(slash + 1, colon)}/manifests/${ref.slice(colon + 1)}`;
}

export async function verifiedImageRef(ref: string): Promise<string | null> {
	try {
		const response = await fetch(manifestUrl(ref), {
			method: 'HEAD',
			headers: { Accept: ACCEPT, ...(await registryAuthHeaders()) },
			signal: AbortSignal.timeout(5000)
		});
		const digest = response.headers.get('docker-content-digest');
		return response.ok && digest && /^sha256:[0-9a-f]{64}$/.test(digest) ? `${ref.slice(0, ref.lastIndexOf(':'))}@${digest}` : null;
	} catch {
		return null;
	}
}

export async function promoteBuildCache(source: string, target: string): Promise<void> {
	try {
		const headers = await registryAuthHeaders();
		const manifest = await fetch(manifestUrl(source), { headers: { Accept: ACCEPT, ...headers }, signal: AbortSignal.timeout(5000) });
		if (!manifest.ok) return;
		await fetch(manifestUrl(target), {
			method: 'PUT',
			headers: { 'Content-Type': manifest.headers.get('content-type') ?? 'application/vnd.oci.image.index.v1+json', ...headers },
			body: await manifest.text(),
			signal: AbortSignal.timeout(5000)
		});
	} catch {
		/* Cache promotion is optional; a later build can rebuild missing layers. */
	}
}
