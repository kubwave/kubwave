import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ApiextensionsV1Api, AppsV1Api, CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import * as realHelm from '../src/lib/helm.js';
import { clackStub } from './support/clack-stub.js';

const execHelmCalls: string[][] = [];
let execHelmResults = [{ stdout: '', stderr: '', exitCode: 0 }];
let confirmResult = true;
const promptEvents: string[] = [];

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	execHelm: async (args: string[]) => {
		execHelmCalls.push(args);
		return execHelmResults.shift() ?? { stdout: '', stderr: '', exitCode: 0 };
	}
}));

mock.module('@clack/prompts', () => ({
	...clackStub(),
	confirm: mock(async () => confirmResult),
	isCancel: () => false,
	log: {
		...clackStub().log,
		success: (message: string) => promptEvents.push(`success:${message}`),
		warn: (message: string) => promptEvents.push(`warn:${message}`),
		error: (message: string) => promptEvents.push(`error:${message}`),
		info: (message: string) => promptEvents.push(`info:${message}`)
	},
	spinner: () => ({
		start: (message: string) => promptEvents.push(`start:${message}`),
		stop: (message: string) => promptEvents.push(`stop:${message}`)
	})
}));

const {
	buildHelmDependencyInstallArgs,
	checkDependencies,
	ensureDependencies,
	ensureDependenciesSilent,
	getDependencies,
	helmRepoAddAndInstall,
	waitForCertManagerReady,
	waitForTraefikReady,
	waitForCnpgReady
} = await import('../src/lib/dependencies.js');

describe('dependency helm install args', () => {
	test('uses helm wait and 5m timeout by default', () => {
		expect(buildHelmDependencyInstallArgs('jetstack/cert-manager', 'cert-manager', 'cert-manager')).toEqual([
			'upgrade',
			'--install',
			'cert-manager',
			'jetstack/cert-manager',
			'--namespace',
			'cert-manager',
			'--create-namespace',
			'--wait',
			'--timeout',
			'5m'
		]);
	});

	test('can omit helm wait for traefik', () => {
		const args = buildHelmDependencyInstallArgs('traefik/traefik', 'traefik', 'traefik', ['--set', 'ingressClass.enabled=true'], { wait: false });

		expect(args).toEqual([
			'upgrade',
			'--install',
			'traefik',
			'traefik/traefik',
			'--namespace',
			'traefik',
			'--create-namespace',
			'--set',
			'ingressClass.enabled=true'
		]);
		expect(args).not.toContain('--wait');
	});
});

describe('dependency helm installation', () => {
	test('adds a repo, updates it, and runs upgrade install args', async () => {
		execHelmCalls.length = 0;
		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 }
		];

		await helmRepoAddAndInstall({ name: 'jetstack', url: 'https://charts.jetstack.io' }, 'jetstack/cert-manager', 'cert-manager', 'cert-manager', [
			'--set',
			'crds.enabled=true'
		]);

		expect(execHelmCalls[0]).toEqual(['repo', 'add', 'jetstack', 'https://charts.jetstack.io', '--force-update']);
		expect(execHelmCalls[1]).toEqual(['repo', 'update', 'jetstack']);
		expect(execHelmCalls[2]).toContain('jetstack/cert-manager');
		expect(execHelmCalls[2]).toContain('crds.enabled=true');
	});

	test('reports repo add and install failures', async () => {
		execHelmCalls.length = 0;
		execHelmResults = [{ stdout: '', stderr: 'repo denied', exitCode: 1 }];
		await expect(helmRepoAddAndInstall({ name: 'bad', url: 'https://example.invalid' }, 'bad/chart', 'bad', 'bad')).rejects.toThrow(
			'Helm repo "bad" could not be added'
		);

		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: 'install denied', exitCode: 1 }
		];
		await expect(helmRepoAddAndInstall({ name: 'bad', url: 'https://example.invalid' }, 'bad/chart', 'bad', 'bad')).rejects.toThrow(
			'Installation of "bad" failed'
		);
	});
});

describe('dependency checks and installation orchestration', () => {
	test('returns the registered dependency checks', () => {
		expect(getDependencies().map(dep => dep.name)).toEqual(['Traefik', 'cert-manager', 'CloudNativePG']);
	});

	test('detects installed, alternative, missing, and failed dependencies', async () => {
		let result = await checkDependencies(
			createKubeConfigStub({ ingressClasses: [{ metadata: { name: 'traefik' } }], crd: establishedCrd(), deployments: certManagerDeployments() })
		);
		expect(result.map(r => r.status)).toEqual([
			{ installed: true, message: 'Traefik IngressClass found' },
			{ installed: true, message: 'cert-manager controller ready' },
			{ installed: true, message: 'CloudNativePG CRDs found' }
		]);

		result = await checkDependencies(createKubeConfigStub({ ingressClasses: [{ metadata: { name: 'nginx' } }], crdError: { code: 404 } }));
		expect(result.map(r => r.status)).toEqual([
			{ installed: true, message: 'IngressClass found: nginx (not Traefik, but present)' },
			{ installed: false, message: 'cert-manager is not installed' },
			{ installed: false, message: 'CloudNativePG is not installed' }
		]);

		result = await checkDependencies(createKubeConfigStub({ ingressClasses: [], crdError: { code: 500 } }));
		expect(result.map(r => r.status)).toEqual([
			{ installed: false, message: 'No IngressClass found' },
			{ installed: false, message: 'cert-manager check failed' },
			{ installed: false, message: 'CloudNativePG check failed' }
		]);

		result = await checkDependencies(
			createKubeConfigStub({ ingressClassListError: new Error('network'), crd: establishedCrd(), deployments: certManagerDeployments() })
		);
		expect(result[0]!.status).toEqual({ installed: false, message: 'IngressClass check failed' });
	});

	test('does not treat stale cert-manager CRDs as an installed controller', async () => {
		const result = await checkDependencies(createKubeConfigStub({ ingressClasses: [{ metadata: { name: 'traefik' } }], crd: establishedCrd() }));
		expect(result[1]!.status).toEqual({
			installed: false,
			message: 'cert-manager CRDs found, but controller deployments are not ready: cert-manager, cert-manager-webhook, cert-manager-cainjector'
		});
	});

	test('silently installs missing dependencies and reports progress', async () => {
		execHelmCalls.length = 0;
		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 }
		];
		const reporter = recordingReporter();
		const kc = createKubeConfigStub({
			ingressClasses: [],
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } },
			ingressClass: {},
			service: { spec: { type: 'LoadBalancer' }, status: { loadBalancer: { ingress: [] } } },
			crd: establishedCrd(),
			deployments: certManagerDeployments()
		});

		await expect(ensureDependenciesSilent(kc, reporter, createDependencyStateStub())).resolves.toEqual([
			{ name: 'Traefik', alreadyInstalled: false, installed: true, message: 'Traefik successfully installed' },
			{ name: 'cert-manager', alreadyInstalled: true, installed: false, message: 'cert-manager controller ready' },
			{ name: 'CloudNativePG', alreadyInstalled: true, installed: false, message: 'CloudNativePG CRDs found' }
		]);
		const valuesFile = execHelmCalls[2]![execHelmCalls[2]!.indexOf('-f') + 1]!;
		const values = parse(readFileSync(valuesFile, 'utf8'));
		expect(values).toMatchObject({
			ingressClass: { enabled: true, isDefaultClass: true },
			deployment: { replicas: 2 },
			podDisruptionBudget: { enabled: true, minAvailable: 1 },
			service: { type: 'LoadBalancer' },
			nodeSelector: { 'cfke.io/provider': 'hetzner' }
		});
		expect(reporter.events).toContain('succeed:Traefik installed');
		expect(reporter.events).toContain('succeed:cert-manager: cert-manager controller ready');
	});

	test('silent dependency repair skips helm when dependencies are already installed', async () => {
		execHelmCalls.length = 0;
		execHelmResults = [{ stdout: '', stderr: '', exitCode: 0 }];
		const reporter = recordingReporter();
		const kc = createKubeConfigStub({
			ingressClasses: [{ metadata: { name: 'traefik' } }],
			crd: establishedCrd(),
			deployments: certManagerDeployments()
		});

		await expect(ensureDependenciesSilent(kc, reporter, createDependencyStateStub())).resolves.toEqual([
			{ name: 'Traefik', alreadyInstalled: true, installed: false, message: 'Traefik IngressClass found' },
			{ name: 'cert-manager', alreadyInstalled: true, installed: false, message: 'cert-manager controller ready' },
			{ name: 'CloudNativePG', alreadyInstalled: true, installed: false, message: 'CloudNativePG CRDs found' }
		]);
		expect(execHelmCalls).toEqual([]);
		expect(reporter.events).toContain('succeed:Traefik: Traefik IngressClass found');
		expect(reporter.events).toContain('succeed:cert-manager: cert-manager controller ready');
	});

	test('silent dependency repair installs only missing dependencies', async () => {
		execHelmCalls.length = 0;
		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 }
		];
		const reporter = recordingReporter();
		const kc = createKubeConfigStub({
			ingressClasses: [{ metadata: { name: 'traefik' } }],
			crdError: { code: 404 },
			// cnpg already present so only cert-manager installs.
			cnpgCrd: {}
		});

		await expect(ensureDependenciesSilent(kc, reporter, createDependencyStateStub())).resolves.toEqual([
			{ name: 'Traefik', alreadyInstalled: true, installed: false, message: 'Traefik IngressClass found' },
			{ name: 'cert-manager', alreadyInstalled: false, installed: true, message: 'cert-manager successfully installed' },
			{ name: 'CloudNativePG', alreadyInstalled: true, installed: false, message: 'CloudNativePG CRDs found' }
		]);
		expect(execHelmCalls).toHaveLength(3);
		expect(execHelmCalls[2]).toContain('jetstack/cert-manager');
		expect(execHelmCalls[2]).not.toContain('traefik/traefik');
	});

	test('reports silent install failures', async () => {
		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: 'install failed', exitCode: 1 }
		];
		const reporter = recordingReporter();
		const kc = createKubeConfigStub({
			ingressClasses: [],
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } },
			ingressClass: {},
			crd: establishedCrd(),
			deployments: certManagerDeployments()
		});

		await expect(ensureDependenciesSilent(kc, reporter)).rejects.toThrow('Installation of "traefik" failed');
		expect(reporter.events).toContain('fail:Traefik installation failed:Installation of "traefik" failed:\ninstall failed');
	});

	test('reports interactive install failures', async () => {
		execHelmCalls.length = 0;
		promptEvents.length = 0;
		confirmResult = true;
		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: 'install failed', exitCode: 1 }
		];
		const kc = createKubeConfigStub({
			ingressClasses: [],
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } },
			ingressClass: {},
			crd: establishedCrd(),
			deployments: certManagerDeployments()
		});

		await expect(ensureDependencies(kc)).rejects.toThrow('Installation of "traefik" failed');
		expect(promptEvents).toContain('stop:Traefik installation failed');
		expect(promptEvents).toContain('error:Installation of "traefik" failed:\ninstall failed');
	});

	test('silently installs CloudNativePG when only its CRD is missing', async () => {
		execHelmCalls.length = 0;
		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 }
		];
		const reporter = recordingReporter();
		const kc = createKubeConfigStub({
			ingressClasses: [{ metadata: { name: 'traefik' } }],
			crd: establishedCrd(),
			deployments: certManagerDeployments(),
			cnpgCrdError: { code: 404 }
		});

		await expect(ensureDependenciesSilent(kc, reporter, createDependencyStateStub())).resolves.toContainEqual({
			name: 'CloudNativePG',
			alreadyInstalled: false,
			installed: true,
			message: 'CloudNativePG successfully installed'
		});
		expect(execHelmCalls[2]).toContain('cnpg/cloudnative-pg');
	});
});

describe('traefik readiness', () => {
	test('succeeds when deployment is ready and IngressClass exists', async () => {
		const kc = createKubeConfigStub({
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } },
			ingressClass: {}
		});

		await expect(waitForTraefikReady(kc, { timeoutMs: 10, pollMs: 1 })).resolves.toBeUndefined();
	});

	test('fails when deployment does not become ready', async () => {
		const kc = createKubeConfigStub({
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 0, updatedReplicas: 1 } },
			ingressClass: {}
		});

		await expect(waitForTraefikReady(kc, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow('Traefik did not become ready within 0s');
	});

	test('fails when IngressClass is missing', async () => {
		const kc = createKubeConfigStub({
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } },
			ingressClassError: { code: 404 }
		});

		await expect(waitForTraefikReady(kc, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow('Traefik did not become ready within 0s');
	});

	test('includes the last deployment read error when Traefik readiness times out', async () => {
		const kc = createKubeConfigStub({
			deploymentError: new Error('deployment API unavailable'),
			ingressClass: {}
		});

		await expect(waitForTraefikReady(kc, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow('Last error: deployment API unavailable');
	});
});

describe('cert-manager readiness', () => {
	test('succeeds when the ClusterIssuer CRD is established and controller deployments are ready', async () => {
		const kc = createKubeConfigStub({ crd: establishedCrd(), deployments: certManagerDeployments() });
		await expect(waitForCertManagerReady(kc, { timeoutMs: 10, pollMs: 1 })).resolves.toBeUndefined();
	});

	test('rethrows unexpected CRD read errors', async () => {
		const kc = createKubeConfigStub({ crdError: new Error('api unavailable') });
		await expect(waitForCertManagerReady(kc, { timeoutMs: 10, pollMs: 1 })).rejects.toThrow('api unavailable');
	});

	test('times out when the ClusterIssuer CRD never appears', async () => {
		const kc = createKubeConfigStub({ crdError: { code: 404 } });
		await expect(waitForCertManagerReady(kc, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow('cert-manager did not become ready');
	});

	test('times out when only the CRDs exist', async () => {
		const kc = createKubeConfigStub({ crd: establishedCrd() });
		await expect(waitForCertManagerReady(kc, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow(
			'deployments not ready: cert-manager, cert-manager-webhook, cert-manager-cainjector'
		);
	});
});

describe('cnpg readiness', () => {
	test('succeeds when the Cluster CRD is Established', async () => {
		const kc = createKubeConfigStub({ cnpgCrd: { status: { conditions: [{ type: 'Established', status: 'True' }] } } });
		await expect(waitForCnpgReady(kc, { timeoutMs: 10, pollMs: 1 })).resolves.toBeUndefined();
	});

	test('fails when the Cluster CRD never becomes Established', async () => {
		const kc = createKubeConfigStub({ cnpgCrd: { status: { conditions: [] } } });
		await expect(waitForCnpgReady(kc, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow('did not become established');
	});

	test('rethrows unexpected CNPG CRD read errors', async () => {
		const kc = createKubeConfigStub({ cnpgCrdError: new Error('api unavailable') });
		await expect(waitForCnpgReady(kc, { timeoutMs: 10, pollMs: 1 })).rejects.toThrow('api unavailable');
	});

	test('times out while the CNPG CRD is still missing', async () => {
		const kc = createKubeConfigStub({ cnpgCrdError: { code: 404 } });
		await expect(waitForCnpgReady(kc, { timeoutMs: 1, pollMs: 1 })).rejects.toThrow('did not become established');
	});
});

function createKubeConfigStub(state: {
	deployment?: unknown;
	deploymentError?: unknown;
	ingressClass?: unknown;
	ingressClassError?: unknown;
	ingressClasses?: unknown[];
	ingressClassListError?: unknown;
	deployments?: Record<string, unknown>;
	deploymentErrors?: Record<string, unknown>;
	crd?: unknown;
	crdError?: unknown;
	cnpgCrd?: unknown;
	cnpgCrdError?: unknown;
	service?: unknown;
}) {
	return {
		makeApiClient(api: unknown) {
			if (api === AppsV1Api) {
				return {
					readNamespacedDeployment: async ({ name }: { name: string }) => {
						if (state.deploymentErrors && Object.prototype.hasOwnProperty.call(state.deploymentErrors, name)) {
							throw state.deploymentErrors[name];
						}
						if (state.deployments && Object.prototype.hasOwnProperty.call(state.deployments, name)) {
							return state.deployments[name];
						}
						if (state.deploymentError) throw state.deploymentError;
						if (name === 'traefik' && state.deployment !== undefined) return state.deployment;
						throw { code: 404 };
					}
				};
			}
			if (api === NetworkingV1Api) {
				return {
					listIngressClass: async () => {
						if (state.ingressClassListError) throw state.ingressClassListError;
						return { items: state.ingressClasses ?? [] };
					},
					readIngressClass: async () => {
						if (state.ingressClassError) throw state.ingressClassError;
						return state.ingressClass;
					}
				};
			}
			if (api === ApiextensionsV1Api) {
				return {
					readCustomResourceDefinition: async ({ name }: { name: string }) => {
						// cert-manager and cnpg both check a CRD; cnpg-specific state takes precedence,
						// else both share crd/crdError.
						const isCnpg = name === 'clusters.postgresql.cnpg.io';
						if (isCnpg && (state.cnpgCrd !== undefined || state.cnpgCrdError !== undefined)) {
							if (state.cnpgCrdError) throw state.cnpgCrdError;
							return state.cnpgCrd;
						}
						if (state.crdError) throw state.crdError;
						if (state.crd !== undefined) return state.crd;
						throw { code: 404 };
					}
				};
			}
			if (api === CoreV1Api) {
				return {
					readNamespacedService: async () => state.service ?? {}
				};
			}
			throw new Error('unexpected api');
		}
	} as never;
}

function readyDeployment() {
	return { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } };
}

function establishedCrd() {
	return { status: { conditions: [{ type: 'Established', status: 'True' }] } };
}

function certManagerDeployments() {
	return {
		'cert-manager': readyDeployment(),
		'cert-manager-webhook': readyDeployment(),
		'cert-manager-cainjector': readyDeployment()
	};
}

function recordingReporter() {
	const events: string[] = [];
	return {
		events,
		start: (msg: string) => events.push(`start:${msg}`),
		succeed: (msg: string) => events.push(`succeed:${msg}`),
		fail: (msg: string, detail: string) => events.push(`fail:${msg}:${detail}`),
		log: (msg: string) => events.push(`log:${msg}`)
	};
}

function createDependencyStateStub() {
	return {
		traefik: {
			kind: 'traefik',
			namespace: 'traefik',
			releaseName: 'traefik',
			ingressClassName: 'traefik',
			helmValues: {
				deployment: { replicas: 2 },
				podDisruptionBudget: { enabled: true, minAvailable: 1 },
				service: { type: 'LoadBalancer' },
				nodeSelector: { 'cfke.io/provider': 'hetzner' }
			}
		}
	} as never;
}
