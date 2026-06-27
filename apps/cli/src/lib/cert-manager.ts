import { CustomObjectsApi, type KubeConfig } from '@kubernetes/client-node';
import { CERT_MANAGER_ACME_SERVER, CERT_MANAGER_CLUSTER_ISSUER_NAME } from '~/lib/constants.js';
import { mergeDependencyState, type DependencyStateInput } from '~/lib/dependency-state.js';
import { FatalCliError } from '~/lib/errors.js';
import { isNotFoundError } from '~/lib/k8s-errors.js';
import { isRecord, readString } from '~/lib/object-path.js';

const CERT_MANAGER_GROUP = 'cert-manager.io';
const CERT_MANAGER_VERSION = 'v1';
const CLUSTER_ISSUER_PLURAL = 'clusterissuers';

export interface CertManagerClusterIssuerConfig {
	name: string;
	create: boolean;
	email?: string;
}

export interface ClusterIssuerResolution {
	action: 'create' | 'reuse';
	clusterIssuer: CertManagerClusterIssuerConfig;
	existingEmail?: string;
	emailMismatch: boolean;
}

export interface ResolveCertManagerClusterIssuerInput {
	email: string;
	dependencies?: DependencyStateInput;
}

interface ClusterIssuer {
	spec?: {
		acme?: {
			server?: string;
			email?: string;
			solvers?: unknown[];
		};
	};
}

export async function resolveCertManagerClusterIssuer(kc: KubeConfig, input: ResolveCertManagerClusterIssuerInput): Promise<ClusterIssuerResolution> {
	const ingressClassName = mergeDependencyState(input.dependencies).traefik.ingressClassName;
	const existing = await readClusterIssuer(kc, CERT_MANAGER_CLUSTER_ISSUER_NAME);

	if (!existing) {
		return {
			action: 'create',
			clusterIssuer: {
				name: CERT_MANAGER_CLUSTER_ISSUER_NAME,
				create: true,
				email: input.email
			},
			emailMismatch: false
		};
	}

	assertCompatibleClusterIssuer(existing, ingressClassName);

	const existingEmail = existing.spec?.acme?.email;
	return {
		action: 'reuse',
		clusterIssuer: {
			name: CERT_MANAGER_CLUSTER_ISSUER_NAME,
			create: false
		},
		...(existingEmail ? { existingEmail } : {}),
		emailMismatch: Boolean(existingEmail && existingEmail !== input.email)
	};
}

async function readClusterIssuer(kc: KubeConfig, name: string): Promise<ClusterIssuer | undefined> {
	const api = kc.makeApiClient(CustomObjectsApi);
	try {
		const issuer = await api.getClusterCustomObject({
			group: CERT_MANAGER_GROUP,
			version: CERT_MANAGER_VERSION,
			plural: CLUSTER_ISSUER_PLURAL,
			name
		});
		return isRecord(issuer) ? (issuer as ClusterIssuer) : undefined;
	} catch (err) {
		if (isNotFoundError(err)) return undefined;
		throw err;
	}
}

function assertCompatibleClusterIssuer(issuer: ClusterIssuer, ingressClassName: string): void {
	const server = issuer.spec?.acme?.server;
	const errors: string[] = [];

	if (server !== CERT_MANAGER_ACME_SERVER) {
		errors.push(`ACME server is ${server ? `"${server}"` : 'missing'}, expected "${CERT_MANAGER_ACME_SERVER}"`);
	}

	if (!hasHttp01SolverForIngressClass(issuer, ingressClassName)) {
		errors.push(`no HTTP-01 solver uses ingressClassName "${ingressClassName}"`);
	}

	if (errors.length === 0) return;

	throw new FatalCliError(
		`ClusterIssuer "${CERT_MANAGER_CLUSTER_ISSUER_NAME}" already exists but is not compatible with this install: ${errors.join('; ')}. ` +
			`Remove or rename the existing issuer, or configure it for Let's Encrypt production HTTP-01 with ingressClassName "${ingressClassName}".`
	);
}

function hasHttp01SolverForIngressClass(issuer: ClusterIssuer, ingressClassName: string): boolean {
	const solvers = issuer.spec?.acme?.solvers;
	if (!Array.isArray(solvers)) return false;

	return solvers.some(solver => readString(solver, ['http01', 'ingress', 'ingressClassName']) === ingressClassName);
}
