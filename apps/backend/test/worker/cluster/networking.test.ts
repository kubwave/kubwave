import { describe, expect, test } from 'bun:test';
import type { CoreV1Api, NetworkingV1Api, V1Ingress, V1Service } from '@kubernetes/client-node';
import type { Deployment, DeploymentLogEntry, ServiceDomain } from '@kubwave/db';

// Nothing mocked (real @kubwave/kube + ./ops); fake Core/Networking APIs drive converge/teardown. internalServiceName === resourceName.
import { convergeNetworking, teardownNetworking, type IngressOptions } from '~/shared/cluster/networking';

const SERVICE_ID = 'abc';
const NAME = 'svc-abc'; // resourceName === internalServiceName for this id

function deployment(): Deployment {
	return { serviceId: SERVICE_ID } as unknown as Deployment;
}

function domain(host: string, port: number): ServiceDomain {
	return { host, port } as unknown as ServiceDomain;
}

const noIngress: IngressOptions = { className: undefined, clusterIssuer: undefined, annotations: {} };

interface ServiceState {
	existing: V1Service | null;
}

function fakeCore(state: ServiceState) {
	const calls = { create: 0, replace: 0, delete: 0 };
	let created: V1Service | undefined;
	let replaced: V1Service | undefined;
	const api = {
		readNamespacedService: async () => {
			if (!state.existing) throw { code: 404 };
			return state.existing;
		},
		createNamespacedService: async ({ body }: { body: V1Service }) => {
			calls.create++;
			created = body;
			return body;
		},
		replaceNamespacedService: async ({ body }: { body: V1Service }) => {
			calls.replace++;
			replaced = body;
			return body;
		},
		deleteNamespacedService: async () => {
			calls.delete++;
		}
	} as unknown as CoreV1Api;
	return { api, calls, getCreated: () => created, getReplaced: () => replaced };
}

interface IngressState {
	existing: V1Ingress | null;
}

function fakeNet(state: IngressState) {
	const calls = { create: 0, replace: 0, delete: 0 };
	let created: V1Ingress | undefined;
	let replaced: V1Ingress | undefined;
	const api = {
		readNamespacedIngress: async () => {
			if (!state.existing) throw { code: 404 };
			return state.existing;
		},
		createNamespacedIngress: async ({ body }: { body: V1Ingress }) => {
			calls.create++;
			created = body;
			return body;
		},
		replaceNamespacedIngress: async ({ body }: { body: V1Ingress }) => {
			calls.replace++;
			replaced = body;
			return body;
		},
		deleteNamespacedIngress: async () => {
			calls.delete++;
		}
	} as unknown as NetworkingV1Api;
	return { api, calls, getCreated: () => created, getReplaced: () => replaced };
}

async function run(args: {
	core: ReturnType<typeof fakeCore>;
	net: ReturnType<typeof fakeNet>;
	ports: number[];
	domains: ServiceDomain[];
	ingress?: IngressOptions;
}): Promise<DeploymentLogEntry[]> {
	const events: DeploymentLogEntry[] = [];
	await convergeNetworking({
		coreApi: args.core.api,
		netApi: args.net.api,
		namespace: 'ns',
		deployment: deployment(),
		ports: args.ports,
		domains: args.domains,
		ingress: args.ingress ?? noIngress,
		events
	});
	return events;
}

function stepMessages(events: DeploymentLogEntry[], step: string): string[] {
	return events.filter(e => e.step === step).map(e => e.message);
}

describe('convergeNetworking — Service', () => {
	test('creates the ClusterIP Service with named, deduped, sorted ports and a step event', async () => {
		const core = fakeCore({ existing: null });
		const net = fakeNet({ existing: null });
		// container ports [8080] ∪ domain ports [80, 80] → {80, 8080}
		const events = await run({ core, net, ports: [8080], domains: [domain('a.test', 80), domain('b.test', 80)] });

		expect(core.calls.create).toBe(1);
		const body = core.getCreated()!;
		expect(body.spec?.type).toBe('ClusterIP');
		expect(body.spec?.selector).toEqual({ 'kubwave/service-id': SERVICE_ID });
		expect(body.spec?.ports).toEqual([
			{ name: 'p-80', port: 80, targetPort: 80, protocol: 'TCP' },
			{ name: 'p-8080', port: 8080, targetPort: 8080, protocol: 'TCP' }
		]);
		expect(stepMessages(events, 'service-converged')).toEqual([`Created Service ${NAME} in ns (ports: 80, 8080)`]);
	});

	test('replaces on a port-set change, carrying over the immutable clusterIP/resourceVersion', async () => {
		const core = fakeCore({
			existing: {
				metadata: { name: NAME, resourceVersion: '99' },
				spec: { clusterIP: '10.1.2.3', clusterIPs: ['10.1.2.3'], ports: [{ port: 80 }] }
			} as V1Service
		});
		const net = fakeNet({ existing: null });
		const events = await run({ core, net, ports: [8080], domains: [] });

		expect(core.calls.replace).toBe(1);
		expect(core.calls.create).toBe(0);
		const body = core.getReplaced()!;
		expect(body.metadata?.resourceVersion).toBe('99');
		expect(body.spec?.clusterIP).toBe('10.1.2.3');
		expect(body.spec?.clusterIPs).toEqual(['10.1.2.3']);
		expect(body.spec?.ports?.map(p => p.port)).toEqual([8080]);
		expect(stepMessages(events, 'service-converged')).toEqual([`Updated Service ${NAME} in ns (ports: 8080)`]);
	});

	test('deletes the Service (and emits a removed event) when no ports are exposed', async () => {
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 80 }] } } as V1Service });
		const net = fakeNet({ existing: null });
		const events = await run({ core, net, ports: [], domains: [] });

		expect(core.calls.delete).toBe(1);
		expect(stepMessages(events, 'service-converged')).toEqual([`Removed Service ${NAME} in ns (no ports exposed)`]);
	});

	test('is unchanged (no call, no event) when there is no Service and no ports', async () => {
		const core = fakeCore({ existing: null });
		const net = fakeNet({ existing: null });
		const events = await run({ core, net, ports: [], domains: [] });

		expect(core.calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(stepMessages(events, 'service-converged')).toEqual([]);
	});

	test('is unchanged (no call, no event) when the existing port set already matches', async () => {
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 80 }, { port: 8080 }] } } as V1Service });
		const net = fakeNet({ existing: null });
		const events = await run({ core, net, ports: [8080], domains: [domain('a.test', 80)] });

		expect(core.calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(stepMessages(events, 'service-converged')).toEqual([]);
	});
});

describe('convergeNetworking — Ingress', () => {
	test('creates one Ingress with a rule per domain → service port and a step event', async () => {
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 80 }] } } as V1Service });
		const net = fakeNet({ existing: null });
		const events = await run({ core, net, ports: [], domains: [domain('b.test', 80), domain('a.test', 443)] });

		expect(net.calls.create).toBe(1);
		const body = net.getCreated()!;
		expect(body.spec?.rules?.map(r => r.host)).toEqual(['b.test', 'a.test']);
		const firstBackend = body.spec?.rules?.[0]?.http?.paths?.[0]?.backend?.service;
		expect(firstBackend).toEqual({ name: NAME, port: { number: 80 } });
		// Event host list is sorted.
		expect(stepMessages(events, 'ingress-converged')).toEqual([`Created Ingress ${NAME} in ns (hosts: a.test, b.test)`]);
	});

	test('omits spec.tls and the cert-manager annotation when no clusterIssuer is set', async () => {
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 80 }] } } as V1Service });
		const net = fakeNet({ existing: null });
		await run({
			core,
			net,
			ports: [],
			domains: [domain('a.test', 80)],
			ingress: { className: undefined, clusterIssuer: undefined, annotations: {} }
		});

		const body = net.getCreated()!;
		expect(body.spec?.tls).toBeUndefined();
		expect(body.metadata?.annotations).toBeUndefined();
		expect(body.spec?.ingressClassName).toBeUndefined();
	});

	test('adds spec.tls (covering all hosts) and the cert-manager annotation when a clusterIssuer is set', async () => {
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 80 }] } } as V1Service });
		const net = fakeNet({ existing: null });
		await run({
			core,
			net,
			ports: [],
			domains: [domain('a.test', 80), domain('b.test', 80)],
			ingress: { className: 'nginx', clusterIssuer: 'letsencrypt', annotations: { 'x/y': 'z' } }
		});

		const body = net.getCreated()!;
		expect(body.spec?.ingressClassName).toBe('nginx');
		expect(body.spec?.tls).toEqual([{ hosts: ['a.test', 'b.test'], secretName: `${NAME}-tls` }]);
		expect(body.metadata?.annotations).toEqual({ 'x/y': 'z', 'cert-manager.io/cluster-issuer': 'letsencrypt' });
	});

	test('replaces on a fingerprint change (host/port), merging live annotations and carrying resourceVersion', async () => {
		const existingIngress = {
			metadata: { name: NAME, resourceVersion: '42', annotations: { 'added-by': 'cert-manager' } },
			spec: {
				rules: [{ host: 'a.test', http: { paths: [{ backend: { service: { name: NAME, port: { number: 80 } } } }] } }]
			}
		} as unknown as V1Ingress;
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 443 }] } } as V1Service });
		const net = fakeNet({ existing: existingIngress });
		// domain port changed 80 → 443 → fingerprint differs → replace
		const events = await run({ core, net, ports: [], domains: [domain('a.test', 443)] });

		expect(net.calls.replace).toBe(1);
		expect(net.calls.create).toBe(0);
		const body = net.getReplaced()!;
		expect(body.metadata?.resourceVersion).toBe('42');
		// Controller-added annotation is preserved (merged under our own).
		expect(body.metadata?.annotations).toMatchObject({ 'added-by': 'cert-manager' });
		expect(stepMessages(events, 'ingress-converged')).toEqual([`Updated Ingress ${NAME} in ns (hosts: a.test)`]);
	});

	test('replaces when a desired annotation is missing on the live object', async () => {
		const existingIngress = {
			metadata: { name: NAME, resourceVersion: '5' },
			spec: { rules: [{ host: 'a.test', http: { paths: [{ backend: { service: { name: NAME, port: { number: 80 } } } }] } }] }
		} as V1Ingress;
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 80 }] } } as V1Service });
		const net = fakeNet({ existing: existingIngress });
		// Same rules, but we now want an extra annotation the live object lacks → replace.
		const events = await run({
			core,
			net,
			ports: [],
			domains: [domain('a.test', 80)],
			ingress: { className: undefined, clusterIssuer: undefined, annotations: { 'new/ann': 'v' } }
		});

		expect(net.calls.replace).toBe(1);
		expect(stepMessages(events, 'ingress-converged')).toEqual([`Updated Ingress ${NAME} in ns (hosts: a.test)`]);
	});

	test('deletes the Ingress (removed event) when the service has no domains', async () => {
		const core = fakeCore({ existing: null });
		const net = fakeNet({ existing: { metadata: { name: NAME }, spec: { rules: [] } } as V1Ingress });
		const events = await run({ core, net, ports: [8080], domains: [] });

		expect(net.calls.delete).toBe(1);
		expect(stepMessages(events, 'ingress-converged')).toEqual([`Removed Ingress ${NAME} in ns (no domains)`]);
	});

	test('is unchanged (no call, no event) when no Ingress exists and no domains', async () => {
		const core = fakeCore({ existing: null });
		const net = fakeNet({ existing: null });
		const events = await run({ core, net, ports: [8080], domains: [] });

		expect(net.calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(stepMessages(events, 'ingress-converged')).toEqual([]);
	});

	test('is unchanged (no call, no event) when the live Ingress already matches the desired one', async () => {
		const matching = {
			metadata: { name: NAME, resourceVersion: '1' },
			spec: { rules: [{ host: 'a.test', http: { paths: [{ backend: { service: { name: NAME, port: { number: 80 } } } }] } }] }
		} as V1Ingress;
		const core = fakeCore({ existing: { metadata: { name: NAME }, spec: { ports: [{ port: 80 }] } } as V1Service });
		const net = fakeNet({ existing: matching });
		const events = await run({ core, net, ports: [], domains: [domain('a.test', 80)] });

		expect(net.calls).toEqual({ create: 0, replace: 0, delete: 0 });
		expect(stepMessages(events, 'ingress-converged')).toEqual([]);
	});
});

describe('teardownNetworking', () => {
	test('deletes both the Service and the Ingress by name, ignoring 404s', async () => {
		const core = fakeCore({ existing: null });
		const net = fakeNet({ existing: null });
		await teardownNetworking({ coreApi: core.api, netApi: net.api, namespace: 'ns', serviceId: SERVICE_ID });
		expect(core.calls.delete).toBe(1);
		expect(net.calls.delete).toBe(1);
	});

	test('propagates a non-404 delete error', async () => {
		const core = {
			deleteNamespacedService: async () => {
				throw { code: 500 };
			}
		} as unknown as CoreV1Api;
		const net = fakeNet({ existing: null });
		await expect(teardownNetworking({ coreApi: core, netApi: net.api, namespace: 'ns', serviceId: SERVICE_ID })).rejects.toMatchObject({ code: 500 });
	});
});
