import { KubeConfig } from '@kubernetes/client-node';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FatalCliError } from '~/lib/errors.js';

export interface LoadKubeOpts {
	inCluster?: boolean;
	/** Select a non-default kubeconfig context by name (ignored when inCluster). */
	context?: string;
}

// Accepts a bare boolean (legacy: inCluster) or an options object, so old call sites stay untouched while others pass an explicit { context }.
export function loadKubeConfig(opts: boolean | LoadKubeOpts = {}): KubeConfig {
	const o: LoadKubeOpts = typeof opts === 'boolean' ? { inCluster: opts } : opts;
	const kc = new KubeConfig();
	if (o.inCluster) {
		kc.loadFromCluster();
		return kc;
	}
	kc.loadFromDefault();
	if (o.context) {
		if (!kc.getContextObject(o.context)) {
			const available = kc.getContexts().map(c => c.name);
			throw new FatalCliError(`Kube context "${o.context}" not found.` + (available.length ? ` Available: ${available.join(', ')}` : ''));
		}
		kc.setCurrentContext(o.context);
	}
	return kc;
}

export function getClusterInfo(kc: KubeConfig): { server: string; context: string } {
	const currentContext = kc.getCurrentContext();
	const cluster = kc.getCurrentCluster();
	return {
		server: cluster?.server ?? 'unknown',
		context: currentContext
	};
}

// Bun ignores the https.Agent CA @kubernetes/client-node sets; NODE_EXTRA_CA_CERTS must be set before the process starts.
// For a custom-CA kubeconfig, write the CA to a temp file and re-exec with it. Call at the very top of the CLI, before any K8s calls.
export function ensureClusterCA(): void {
	if (process.env['__KUBWAVE_CA_READY']) return;

	const kc = new KubeConfig();
	try {
		kc.loadFromDefault();
	} catch {
		return;
	}

	const cluster = kc.getCurrentCluster();
	if (!cluster) return;

	if (cluster.skipTLSVerify) {
		process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
		process.env['__KUBWAVE_CA_READY'] = '1';
		return;
	}

	let caPath: string | undefined;
	if (cluster.caData) {
		const dir = mkdtempSync(join(tmpdir(), 'kubwave-ca-'));
		caPath = join(dir, 'ca.crt');
		writeFileSync(caPath, Buffer.from(cluster.caData, 'base64'));
	} else if (cluster.caFile) {
		caPath = cluster.caFile;
	}

	if (!caPath) return;
	if (process.env['NODE_EXTRA_CA_CERTS'] === caPath) return;

	const result = Bun.spawnSync(buildReExecCommand(), {
		env: {
			...process.env,
			NODE_EXTRA_CA_CERTS: caPath,
			__KUBWAVE_CA_READY: '1'
		},
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit'
	});
	process.exit(result.exitCode);
}

function buildReExecCommand(): string[] {
	const entrypoint = Bun.argv[1];
	const userArgs = Bun.argv.slice(2);
	const runningViaBun = process.execPath.endsWith('/bun') || process.execPath.endsWith('\\bun.exe');

	if (runningViaBun && entrypoint && !entrypoint.startsWith('/$bunfs/')) {
		return [process.execPath, entrypoint, ...userArgs];
	}

	return [process.execPath, ...userArgs];
}
