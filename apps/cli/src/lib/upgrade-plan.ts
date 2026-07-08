import { writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { APP_NAMESPACE, HELM_RELEASE_NAME } from '~/lib/constants.js';
import { buildProductionValues, dnsPolicyForPlatform } from '~/lib/helm.js';
import { writeValuesFile } from '~/lib/values-file.js';
import { defaultTraefikValuesForPlatform } from '~/lib/platforms.js';
import type { InstallState } from '~/lib/install-state.js';

// Maps InstallState onto the shared production values builder; omitting certManagerClusterIssuer keeps the existing issuer (--reset-then-reuse-values).
export function buildUpgradeValues(state: InstallState, targetVersion: string): Record<string, unknown> {
	// Re-apply platform-specific Traefik defaults so upgrades pick up fixes like the UpCloud
	// TCP-passthrough annotation even when the marker was written by an older CLI version.
	const platformTraefikValues = state.platformId
		? defaultTraefikValuesForPlatform(state.platformId, state.dependencies.traefik.helmValues)
		: undefined;
	const dependencies = platformTraefikValues
		? { ...state.dependencies, traefik: { ...state.dependencies.traefik, helmValues: platformTraefikValues } }
		: state.dependencies;
	return buildProductionValues({
		domain: state.domain,
		imageRegistry: state.imageRegistry,
		buildRegistry:
			state.registryMode === 'unconfigured'
				? { mode: 'unconfigured' }
				: state.registryMode === 'external'
					? { mode: 'external', endpoint: state.registryHost, insecure: state.registryInsecure }
					: {
							mode: 'platform',
							endpoint: state.registryHost,
							ingressEnabled: state.registryIngressEnabled,
							insecure: state.registryInsecure,
							...(state.registryClusterIssuer ? { clusterIssuer: state.registryClusterIssuer } : {})
						},
		version: targetVersion,
		ingressClassName: state.ingressClassName,
		ingressControllerNamespace: state.ingressControllerNamespace,
		...(state.storageClass ? { storageClass: state.storageClass } : {}),
		...(state.nodeSelector && Object.keys(state.nodeSelector).length > 0 ? { nodeSelector: state.nodeSelector } : {}),
		dependencies,
		dnsPolicy: dnsPolicyForPlatform(state.platformId),
		// Preserve HA: the marker (worker-mirrored on toggle) is authoritative for replicas/affinity.
		ha: state.ha,
		// Preserve the tenant PSS level chosen at install so the upgrade doesn't revert to the chart default.
		...(state.tenantPodSecurity !== undefined ? { tenantPodSecurity: state.tenantPodSecurity } : {}),
		// Likewise preserve the tenant runtime class (gVisor) chosen at install so the upgrade doesn't drop the sandbox.
		...(state.tenantRuntimeClass !== undefined ? { tenantRuntimeClass: state.tenantRuntimeClass } : {}),
		...(state.clusterIssuerName ? { clusterIssuerName: state.clusterIssuerName } : {})
	});
}

export function generateUpgradeValuesFile(state: InstallState, targetVersion: string): string {
	return writeValuesFile('kubwave-upgrade-', buildUpgradeValues(state, targetVersion));
}

// In-cluster: write upgrade values to the fixed work-volume path the helm-upgrade container (helm as PID 1) reads via a static -f.
export function writeUpgradeValuesFileTo(state: InstallState, targetVersion: string, destPath: string): string {
	writeFileSync(destPath, stringify(buildUpgradeValues(state, targetVersion)));
	return destPath;
}

export function buildHelmUpgradeArgs(chartPath: string, valuesFilePath: string, namespace: string = APP_NAMESPACE): string[] {
	return [
		'upgrade',
		'--install',
		HELM_RELEASE_NAME,
		chartPath,
		'-f',
		valuesFilePath,
		'--namespace',
		namespace,
		'--reset-then-reuse-values',
		'--atomic',
		'--wait',
		'--timeout',
		'10m'
	];
}
