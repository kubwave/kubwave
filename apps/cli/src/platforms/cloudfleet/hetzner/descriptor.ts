import { makeCloudfleetDescriptor } from '../descriptor-factory.js';
import { promptHetznerOptions } from './options.js';
import { buildHetznerTraefikValues } from './traefik-overrides.js';

export const cloudfleetHetznerDescriptor = makeCloudfleetDescriptor({
	id: 'cloudfleet-hetzner',
	label: 'Cloudfleet (Hetzner)',
	description: 'Cloudfleet-managed Kubernetes auf Hetzner Cloud',
	provider: 'hetzner',
	buildTraefikValues: async opts => buildHetznerTraefikValues(await promptHetznerOptions({ lbLocation: opts.hetznerLbLocation }))
});
