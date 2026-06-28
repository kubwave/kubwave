import { describe, expect, mock, test } from 'bun:test';
import { ApiextensionsV1Api, AppsV1Api, CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';
import * as realHelm from '../src/lib/helm.js';
import { clackStub } from './support/clack-stub.js';

const execHelmCalls: string[][] = [];
let execHelmResults = [{ stdout: '', stderr: '', exitCode: 0 }];

mock.module('~/lib/helm.js', () => ({
	...realHelm,
	execHelm: async (args: string[]) => {
		execHelmCalls.push(args);
		return execHelmResults.shift() ?? { stdout: '', stderr: '', exitCode: 0 };
	}
}));

const cancelled = Symbol('cancelled');
let confirmResult: boolean | symbol = true;

mock.module('@clack/prompts', () => ({
	...clackStub(),
	confirm: mock(async () => confirmResult),
	isCancel: (value: unknown) => value === cancelled
}));

const { ensureDependencies, waitDependencies } = await import('../src/lib/dependencies.js');

describe('ensureDependencies', () => {
	test('skips already installed dependencies', async () => {
		execHelmCalls.length = 0;
		execHelmResults = [{ stdout: '', stderr: '', exitCode: 0 }];

		const kc = kubeStub({
			ingressClasses: [{ metadata: { name: 'traefik' } }],
			crd: establishedCrd(),
			deployments: certManagerDeployments()
		});

		const results = await ensureDependencies(kc, depsState(), 'my-cluster');
		expect(results.map(r => r.name)).toEqual(['Traefik', 'cert-manager', 'CloudNativePG']);
		expect(results.every(r => r.alreadyInstalled)).toBe(true);
		expect(execHelmCalls).toEqual([]);
	});

	test('installs missing dependencies when confirmed', async () => {
		confirmResult = true;
		execHelmCalls.length = 0;
		execHelmResults = [
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 },
			{ stdout: '', stderr: '', exitCode: 0 }
		];

		const kc = kubeStub({
			ingressClasses: [],
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } },
			ingressClass: {},
			service: {}
		});

		const results = await ensureDependencies(kc, depsState(), 'my-cluster');
		const installed = results.filter(r => r.installed);
		expect(installed.length).toBeGreaterThanOrEqual(1);
		expect(installed.map(r => r.name)).toContain('Traefik');
	});
});

describe('waitDependencies', () => {
	test('waits for all dependencies', async () => {
		const kc = kubeStub({
			deployment: { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1 } },
			ingressClass: {},
			cnpgCrd: { status: { conditions: [{ type: 'Established', status: 'True' }] } },
			crd: establishedCrd(),
			deployments: certManagerDeployments()
		});

		const reporter = recordingReporter();
		await expect(waitDependencies(kc, depsState(), reporter)).resolves.toBeUndefined();
		expect(reporter.events).toContain('succeed:Traefik ready');
		expect(reporter.events).toContain('succeed:cert-manager ready');
		expect(reporter.events).toContain('succeed:CloudNativePG ready');
	});
});

function kubeStub(state: {
	deployment?: unknown;
	ingressClass?: unknown;
	ingressClasses?: unknown[];
	deployments?: Record<string, unknown>;
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
						if (state.deployments && Object.prototype.hasOwnProperty.call(state.deployments, name)) {
							return state.deployments[name];
						}
						if (name === 'traefik' && state.deployment !== undefined) return state.deployment;
						throw { code: 404 };
					}
				};
			}
			if (api === NetworkingV1Api) {
				return {
					listIngressClass: async () => ({ items: state.ingressClasses ?? [] }),
					readIngressClass: async () => state.ingressClass
				};
			}
			if (api === ApiextensionsV1Api) {
				return {
					readCustomResourceDefinition: async ({ name }: { name: string }) => {
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
				return { readNamespacedService: async () => state.service ?? {} };
			}
			throw new Error('unexpected api');
		}
	} as never;
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

function depsState() {
	return {
		traefik: {
			kind: 'traefik',
			namespace: 'traefik',
			releaseName: 'traefik',
			ingressClassName: 'traefik',
			helmValues: { deployment: { replicas: 2 }, service: { type: 'LoadBalancer' } }
		}
	} as never;
}
