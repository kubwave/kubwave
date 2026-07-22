import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { writeValuesFile } from '~/lib/values-file.js';
import { mergeObjects } from '~/lib/object-path.js';
import type { TraefikDependencyState } from '~/lib/dependency-state.js';
import { DEFAULT_TCP_PORT_POOL, type TcpPortPoolSettings } from '@kubwave/kube';

export const TRAEFIK_RELEASE = 'traefik';
export const TRAEFIK_CHART_VERSION = '40.2.0';
export const TRAEFIK_CHART = 'traefik/traefik';
export const TRAEFIK_CHART_NAME = 'traefik';
export const TRAEFIK_REPO_URL = 'https://traefik.github.io/charts';

// Public TCP pool: one Traefik entrypoint (`tcp-<port>`) per allocatable port; the worker routes tenant IngressRouteTCPs onto them.
export const TCP_PORT_POOL = DEFAULT_TCP_PORT_POOL;

export function buildTcpPoolPorts(pool: TcpPortPoolSettings = TCP_PORT_POOL): Record<string, unknown> {
	if (!pool.enabled) return {};
	const ports: Record<string, unknown> = {};
	for (let i = 0; i < pool.size; i++) {
		const port = pool.start + i;
		ports[`tcp-${port}`] = { port, expose: { default: true }, exposedPort: port, protocol: 'TCP' };
	}
	return ports;
}

const BASE_TRAEFIK_VALUES = {
	ingressClass: {
		enabled: true,
		isDefaultClass: true
	},
	// Resource requests so CFKE's node auto-provisioner can size nodes for the ingress controller.
	resources: {
		requests: { cpu: '100m', memory: '128Mi' }
	},
	ports: buildTcpPoolPorts()
};

export function defaultTraefikIngressControllerConfig(): TraefikDependencyState {
	return {
		kind: 'traefik',
		namespace: TRAEFIK_NAMESPACE,
		releaseName: TRAEFIK_RELEASE,
		ingressClassName: 'traefik',
		helmValues: {}
	};
}

export function buildTraefikHelmValues(
	config: TraefikDependencyState = defaultTraefikIngressControllerConfig(),
	existingValues: Record<string, unknown> = {}
): Record<string, unknown> {
	const values = mergeObjects(existingValues, BASE_TRAEFIK_VALUES, config.helmValues);
	if ('ports' in config.helmValues) values.ports = config.helmValues.ports;
	return values;
}

export function writeTraefikValuesFile(
	config: TraefikDependencyState = defaultTraefikIngressControllerConfig(),
	existingValues: Record<string, unknown> = {}
): string {
	return writeValuesFile('kubwave-traefik-', buildTraefikHelmValues(config, existingValues));
}
