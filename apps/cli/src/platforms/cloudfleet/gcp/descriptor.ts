import { makeCloudfleetDescriptor } from '../descriptor-factory.js';
import { buildGcpTraefikValues } from './traefik-overrides.js';

// GCP has no install-time options; the CCM picks region/LB automatically.
export const cloudfleetGcpDescriptor = makeCloudfleetDescriptor({
	id: 'cloudfleet-gcp',
	label: 'Cloudfleet (Google Cloud)',
	description: 'Cloudfleet-managed Kubernetes auf Google Cloud',
	provider: 'gcp',
	buildTraefikValues: () => buildGcpTraefikValues()
});
