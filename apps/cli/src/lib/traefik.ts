import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { writeValuesFile } from '~/lib/values-file.js';
import { mergeObjects } from '~/lib/object-path.js';
import type { TraefikDependencyState } from '~/lib/dependency-state.js';

export const TRAEFIK_RELEASE = 'traefik';
export const TRAEFIK_CHART_VERSION = '40.2.0';
export const TRAEFIK_CHART = 'traefik/traefik';
export const TRAEFIK_CHART_NAME = 'traefik';
export const TRAEFIK_REPO_URL = 'https://traefik.github.io/charts';

const BASE_TRAEFIK_VALUES = {
	ingressClass: {
		enabled: true,
		isDefaultClass: true
	}
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

export function buildTraefikHelmValues(config: TraefikDependencyState = defaultTraefikIngressControllerConfig()): Record<string, unknown> {
	return mergeObjects(BASE_TRAEFIK_VALUES, config.helmValues);
}

export function writeTraefikValuesFile(config: TraefikDependencyState = defaultTraefikIngressControllerConfig()): string {
	return writeValuesFile('kubwave-traefik-', buildTraefikHelmValues(config));
}
