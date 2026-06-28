import { describe, expect, mock, test } from 'bun:test';
import { clackStub } from './support/clack-stub.js';

const cancelled = Symbol('cancelled');
let confirmResult: boolean | symbol = true;

mock.module('@clack/prompts', () => ({
	...clackStub(),
	confirm: mock(async () => confirmResult),
	isCancel: (value: unknown) => value === cancelled
}));

const { confirmDependencyInstall, getDependencies, buildHelmDependencyInstallArgs } = await import('../src/lib/dependencies.js');

describe('buildHelmDependencyInstallArgs', () => {
	test('includes --kube-context when context is set', () => {
		const args = buildHelmDependencyInstallArgs('mychart', 'myrelease', 'myns', [], { context: 'my-cluster' });
		expect(args).toContain('--kube-context');
		expect(args).toContain('my-cluster');
	});

	test('omits --kube-context when context is not set', () => {
		const args = buildHelmDependencyInstallArgs('mychart', 'myrelease', 'myns');
		expect(args).not.toContain('--kube-context');
	});

	test('can disable wait', () => {
		const args = buildHelmDependencyInstallArgs('chart', 'release', 'ns', [], { wait: false });
		expect(args).not.toContain('--wait');
	});

	test('custom timeout', () => {
		const args = buildHelmDependencyInstallArgs('chart', 'release', 'ns', [], { timeout: '10m' });
		const timeoutIdx = args.indexOf('--timeout');
		expect(args[timeoutIdx + 1]).toBe('10m');
	});
});

describe('confirmDependencyInstall', () => {
	test('resolves when user confirms', async () => {
		confirmResult = true;
		const traefik = getDependencies().find(dep => dep.id === 'traefik')!;
		await expect(confirmDependencyInstall(traefik)).resolves.toBeUndefined();
	});

	test('throws UserCancelledError when cancelled', async () => {
		confirmResult = cancelled;
		const traefik = getDependencies().find(dep => dep.id === 'traefik')!;
		await expect(confirmDependencyInstall(traefik)).rejects.toThrow('Traefik installation cancelled.');
	});

	test('throws FatalCliError when declined', async () => {
		confirmResult = false;
		const certManager = getDependencies().find(dep => dep.id === 'certManager')!;
		await expect(confirmDependencyInstall(certManager)).rejects.toThrow('cert-manager is required.');
	});
});
