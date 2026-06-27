import { TRAEFIK_NAMESPACE } from '~/lib/constants.js';
import { TRAEFIK_RELEASE, buildTraefikHelmValues } from '~/lib/traefik.js';
import { mergeObjects } from '~/lib/object-path.js';

export interface TraefikDependencyState {
	kind: 'traefik';
	namespace: string;
	releaseName: string;
	ingressClassName: string;
	helmValues: Record<string, unknown>;
}

export interface CertManagerDependencyState {}

export interface CnpgDependencyState {}

export interface DependencyStateMap {
	traefik: TraefikDependencyState;
	certManager: CertManagerDependencyState;
	cnpg: CnpgDependencyState;
}

export interface DependencyStateInput {
	traefik?: Partial<TraefikDependencyState>;
	certManager?: Partial<CertManagerDependencyState>;
	cnpg?: Partial<CnpgDependencyState>;
}

export function defaultDependencyState(): DependencyStateMap {
	return {
		traefik: {
			kind: 'traefik',
			namespace: TRAEFIK_NAMESPACE,
			releaseName: TRAEFIK_RELEASE,
			ingressClassName: 'traefik',
			helmValues: buildTraefikHelmValues()
		},
		certManager: {},
		cnpg: {}
	};
}

export function mergeDependencyState(...inputs: Array<DependencyStateInput | DependencyStateMap | undefined>): DependencyStateMap {
	let state = defaultDependencyState();
	for (const input of inputs) {
		if (!input) continue;
		state = {
			traefik: mergeTraefikState(state.traefik, input.traefik),
			certManager: { ...state.certManager, ...input.certManager },
			cnpg: { ...state.cnpg, ...input.cnpg }
		};
	}
	return state;
}

function mergeTraefikState(base: TraefikDependencyState, input: Partial<TraefikDependencyState> | undefined): TraefikDependencyState {
	if (!input) return base;
	return {
		kind: 'traefik',
		namespace: input.namespace ?? base.namespace,
		releaseName: input.releaseName ?? base.releaseName,
		ingressClassName: input.ingressClassName ?? base.ingressClassName,
		helmValues: mergeObjects(base.helmValues, input.helmValues ?? {})
	};
}
