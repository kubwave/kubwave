import {
	KUBWAVE_PART_OF_LABEL,
	KUBWAVE_PART_OF_VALUE,
	KUBWAVE_COMPONENT_LABEL,
	KUBWAVE_INSTANCE_LABEL,
	KUBWAVE_MANAGED_BY_LABEL,
	KUBWAVE_CLI_MANAGED_BY_VALUE
} from '~/lib/constants.js';

export type KubwaveComponent = 'csi-driver' | 'ingress' | 'cert-manager' | 'database' | 'platform';

export interface OwnershipLabelOpts {
	component: KubwaveComponent;
	instance?: string;
	// Only for resources the CLI fully owns (manifest objects, self-created SCs); omit for third-party helm output.
	cliManaged?: boolean;
}

export function buildOwnershipLabels(opts: OwnershipLabelOpts): Record<string, string> {
	return {
		[KUBWAVE_PART_OF_LABEL]: KUBWAVE_PART_OF_VALUE,
		[KUBWAVE_COMPONENT_LABEL]: opts.component,
		...(opts.instance ? { [KUBWAVE_INSTANCE_LABEL]: opts.instance } : {}),
		...(opts.cliManaged ? { [KUBWAVE_MANAGED_BY_LABEL]: KUBWAVE_CLI_MANAGED_BY_VALUE } : {})
	};
}
