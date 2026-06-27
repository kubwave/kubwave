import { afterEach, describe, expect, mock, test } from 'bun:test';
import { KubeConfig } from '@kubernetes/client-node';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FatalCliError } from '../src/lib/errors.js';
import { ensureClusterCA, getClusterInfo, loadKubeConfig } from '../src/lib/k8s.js';

const proto = KubeConfig.prototype as unknown as Record<string, unknown>;
const originals = new Map<string, unknown>();

for (const key of [
	'loadFromCluster',
	'loadFromDefault',
	'getContextObject',
	'getContexts',
	'setCurrentContext',
	'getCurrentContext',
	'getCurrentCluster'
]) {
	originals.set(key, proto[key]);
}

afterEach(() => {
	for (const [key, value] of originals) proto[key] = value;
	delete process.env['__KUBWAVE_CA_READY'];
	delete process.env['NODE_EXTRA_CA_CERTS'];
	delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
});

describe('kube config helpers', () => {
	test('loads in-cluster kubeconfig for true legacy opts', () => {
		let loaded = false;
		proto['loadFromCluster'] = () => {
			loaded = true;
		};

		expect(loadKubeConfig(true)).toBeInstanceOf(KubeConfig);
		expect(loaded).toBe(true);
	});

	test('loads a named context from the default kubeconfig', () => {
		let selected = '';
		proto['loadFromDefault'] = () => {};
		proto['getContextObject'] = (name: string) => (name === 'prod' ? { name } : undefined);
		proto['setCurrentContext'] = (name: string) => {
			selected = name;
		};

		loadKubeConfig({ context: 'prod' });

		expect(selected).toBe('prod');
	});

	test('reports available contexts when a requested context is missing', () => {
		proto['loadFromDefault'] = () => {};
		proto['getContextObject'] = () => undefined;
		proto['getContexts'] = () => [{ name: 'dev' }, { name: 'prod' }];

		expect(() => loadKubeConfig({ context: 'missing' })).toThrow(FatalCliError);
		expect(() => loadKubeConfig({ context: 'missing' })).toThrow('Available: dev, prod');
	});

	test('reads current cluster info with unknown server fallback', () => {
		expect(
			getClusterInfo({
				getCurrentContext: () => 'dev',
				getCurrentCluster: () => undefined
			} as never)
		).toEqual({ context: 'dev', server: 'unknown' });
	});
});

describe('cluster CA bootstrap', () => {
	test('returns immediately when CA bootstrap is already done', () => {
		process.env['__KUBWAVE_CA_READY'] = '1';
		let loaded = false;
		proto['loadFromDefault'] = () => {
			loaded = true;
		};

		ensureClusterCA();

		expect(loaded).toBe(false);
	});

	test('continues when loading kubeconfig fails or no cluster is active', () => {
		proto['loadFromDefault'] = () => {
			throw new Error('no kubeconfig');
		};
		expect(() => ensureClusterCA()).not.toThrow();

		proto['loadFromDefault'] = () => {};
		proto['getCurrentCluster'] = () => undefined;
		expect(() => ensureClusterCA()).not.toThrow();
	});

	test('sets TLS env flags for skipTLSVerify clusters', () => {
		proto['loadFromDefault'] = () => {};
		proto['getCurrentCluster'] = () => ({ skipTLSVerify: true });

		ensureClusterCA();

		expect(process.env['NODE_TLS_REJECT_UNAUTHORIZED']).toBe('0');
		expect(process.env['__KUBWAVE_CA_READY']).toBe('1');
	});

	test('re-execs with a decoded caData file', () => {
		const realSpawnSync = Bun.spawnSync;
		const realExit = process.exit;
		const calls: Array<{ cmd: string[]; env?: Record<string, string | undefined> }> = [];
		proto['loadFromDefault'] = () => {};
		proto['getCurrentCluster'] = () => ({ caData: Buffer.from('CERT').toString('base64') });
		Bun.spawnSync = mock((cmd: string[], opts: { env?: Record<string, string | undefined> }) => {
			calls.push({ cmd, env: opts.env });
			return { exitCode: 7 } as never;
		}) as never;
		(process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
			throw new ExitSignal(code);
		}) as never;

		try {
			expect(() => ensureClusterCA()).toThrow(ExitSignal);
		} finally {
			Bun.spawnSync = realSpawnSync;
			(process as unknown as { exit: typeof process.exit }).exit = realExit;
		}

		expect(calls).toHaveLength(1);
		expect(calls[0]!.env?.['__KUBWAVE_CA_READY']).toBe('1');
		const caPath = calls[0]!.env?.['NODE_EXTRA_CA_CERTS'];
		expect(typeof caPath).toBe('string');
		expect(readFileSync(caPath!, 'utf8')).toBe('CERT');
	});

	test('does not re-exec when NODE_EXTRA_CA_CERTS already matches caFile', () => {
		const dir = mkdtempSync(join(tmpdir(), 'kubwave-ca-test-'));
		const caFile = join(dir, 'ca.crt');
		process.env['NODE_EXTRA_CA_CERTS'] = caFile;
		proto['loadFromDefault'] = () => {};
		proto['getCurrentCluster'] = () => ({ caFile });

		try {
			expect(() => ensureClusterCA()).not.toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

class ExitSignal extends Error {
	code?: number;

	constructor(code?: number) {
		super(`exit ${code}`);
		this.code = code;
	}
}
