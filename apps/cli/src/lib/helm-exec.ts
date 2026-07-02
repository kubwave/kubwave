import { getHelmPath } from '~/lib/embedded.js';

// Low-level helm spawn, split out so helpers (helm-ownership) can use it without importing helm.ts and forming
// a dependencies ↔ helm ↔ helm-ownership import cycle.
export async function execHelm(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const helmPath = getHelmPath();

	let proc: ReturnType<typeof spawnHelm>;
	try {
		proc = spawnHelm(helmPath, args);
	} catch (err) {
		// Bun.spawn throws synchronously when the OS refuses exec (e.g. EACCES); return a failed result so best-effort readers degrade.
		return { stdout: '', stderr: describeSpawnFailure(helmPath, err), exitCode: 126 };
	}

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { stdout, stderr, exitCode };
}

function spawnHelm(helmPath: string, args: string[]) {
	return Bun.spawn([helmPath, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env }
	});
}

function describeSpawnFailure(helmPath: string, err: unknown): string {
	const code = (err as { code?: string } | null)?.code;
	const base = `Failed to execute helm at ${helmPath}`;
	switch (code) {
		case 'EACCES':
			return `${base}: permission denied. The binary exists but cannot be executed — its filesystem is likely mounted noexec, or the execute bit is missing. In-cluster, set KUBWAVE_HELM_BIN to a helm on an executable filesystem (e.g. the /usr/local/bin/helm baked into the CLI image).`;
		case 'ENOEXEC':
			return `${base}: exec format error — this helm binary was built for a different architecture than the node it is running on.`;
		case 'ENOENT':
			return `${base}: no such file — the helm binary is missing at this path.`;
		default:
			return `${base}: ${err instanceof Error ? err.message : String(err)}`;
	}
}
