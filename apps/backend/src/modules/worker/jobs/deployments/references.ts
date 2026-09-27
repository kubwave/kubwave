import { inArray } from 'drizzle-orm';
import {
	buildDefaultDomainForService,
	db,
	services,
	type DatabaseServiceConfig,
	type DefaultDomainContext,
	type Deployment,
	type RuntimeConfig,
	type ServiceConfig,
	type ServiceType
} from '@kubwave/db';
import { buildDatabaseRuntimeConfig, isDatabaseEngine } from '@kubwave/db/database-engines';
import { internalServiceName } from '@kubwave/kube';
import {
	isReferenceProp,
	mapConfigValues,
	mapReferences,
	REFERENCE_PROPS,
	type ReferenceProp,
	type ServiceReference
} from '../../../../shared/service-references.js';
import { withDefaultDomain } from './deployers/runtime/deployment.js';

// A service of the environment a reference can point at (the deploying service included).
export interface ReferenceTarget {
	id: string;
	name: string;
	type: ServiceType;
	config: ServiceConfig;
}

export type ConfigResolver = (config: ServiceConfig) => ServiceConfig;

export class ReferenceResolutionError extends Error {}

type Resolution = { value: string } | { error: string };
type PublicProp = Extract<ReferenceProp, 'domain' | 'url'>;
type InternalProp = Exclude<ReferenceProp, PublicProp>;

// Databases keep their port in the engine catalog, not in the stored config.
function runtimeConfigOf(target: ReferenceTarget): RuntimeConfig {
	return isDatabaseEngine(target.type) ? buildDatabaseRuntimeConfig(target.type, target.config as DatabaseServiceConfig) : target.config;
}

function internalAddress(target: ReferenceTarget, prop: InternalProp): Resolution {
	const port = runtimeConfigOf(target).containerPort;
	if (port == null) return { error: `service "${target.name}" has no container port` };
	const host = internalServiceName(target.id);
	return { value: { host, port: String(port), internalUrl: `http://${host}:${port}` }[prop] };
}

function publicAddress(target: ReferenceTarget, prop: PublicProp, { settings, runtime }: DefaultDomainContext): Resolution {
	const config = runtimeConfigOf(target);
	const defaultHost = buildDefaultDomainForService(settings, runtime, { serviceId: target.id, serviceName: target.name });
	const domain = withDefaultDomain(config, defaultHost)[0]?.host;
	if (domain) return { value: { domain, url: `${runtime.tls ? 'https' : 'http'}://${domain}` }[prop] };
	const defaultDomainOff = settings.mode === 'off' && config.defaultDomainEnabled === true;
	return {
		error: defaultDomainOff
			? `service "${target.name}" has no custom domain and the platform default domain is off`
			: `service "${target.name}" has no public domain (add a custom domain or enable its default domain)`
	};
}

function resolveReference(target: ReferenceTarget | undefined, ref: ServiceReference, defaultDomain: DefaultDomainContext): Resolution {
	if (!target) return { error: `no service named "${ref.name}" in this environment` };
	if (!isReferenceProp(ref.prop)) return { error: `unknown property "${ref.prop}" (use ${REFERENCE_PROPS.join(', ')})` };
	return ref.prop === 'domain' || ref.prop === 'url' ? publicAddress(target, ref.prop, defaultDomain) : internalAddress(target, ref.prop);
}

// Resolves against the targets' current settings, not their snapshots, so a domain change reaches dependents on their next deploy.
export function referenceResolver(targets: ReferenceTarget[], defaultDomain: DefaultDomainContext): ConfigResolver {
	const byName = new Map(targets.map(target => [target.name, target]));
	return config =>
		mapConfigValues(config, (value, location) =>
			mapReferences(value, (ref, token) => {
				const resolution = resolveReference(byName.get(ref.name), ref, defaultDomain);
				// Names only the location and the token: the surrounding value may be a decrypted secret.
				if ('error' in resolution) throw new ReferenceResolutionError(`Cannot resolve ${token} in ${location}: ${resolution.error}`);
				return resolution.value;
			})
		);
}

// The resolved copy only lives for this pass; the stored snapshot keeps the references (and ciphertext) untouched.
export function resolveDeployment(deployment: Deployment, resolveConfig: ConfigResolver): { deployment: Deployment } | { error: string } {
	try {
		return { deployment: { ...deployment, config: resolveConfig(deployment.config) } };
	} catch (err) {
		if (err instanceof ReferenceResolutionError) return { error: err.message };
		throw err;
	}
}

export async function loadReferenceResolvers(
	environmentIds: string[],
	defaultDomain: DefaultDomainContext
): Promise<(environmentId: string) => ConfigResolver> {
	const rows =
		environmentIds.length === 0
			? []
			: await db
					.select({ id: services.id, environmentId: services.environmentId, name: services.name, type: services.type, config: services.config })
					.from(services)
					.where(inArray(services.environmentId, environmentIds));
	return environmentId =>
		referenceResolver(
			rows.filter(row => row.environmentId === environmentId),
			defaultDomain
		);
}
