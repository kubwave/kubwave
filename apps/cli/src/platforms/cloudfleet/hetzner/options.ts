import * as p from '@clack/prompts';
import { FatalCliError, UserCancelledError } from '~/lib/errors.js';

export const HETZNER_LB_LOCATIONS = ['fsn1', 'nbg1', 'hel1', 'ash', 'hil'] as const;
export type HetznerLbLocation = (typeof HETZNER_LB_LOCATIONS)[number];

const HETZNER_LB_LABELS: Record<HetznerLbLocation, string> = {
	fsn1: 'Falkenstein (fsn1, DE)',
	nbg1: 'Nuremberg (nbg1, DE)',
	hel1: 'Helsinki (hel1, FI)',
	ash: 'Ashburn (ash, US-East)',
	hil: 'Hillsboro (hil, US-West)'
};

export interface CloudfleetHetznerOptions {
	lbLocation: HetznerLbLocation;
}

export async function promptHetznerOptions(opts: { lbLocation?: string }): Promise<CloudfleetHetznerOptions> {
	if (opts.lbLocation) {
		if (!isHetznerLbLocation(opts.lbLocation)) {
			throw new FatalCliError(`Unknown Hetzner LB location "${opts.lbLocation}". Allowed: ${HETZNER_LB_LOCATIONS.join(', ')}.`);
		}
		return { lbLocation: opts.lbLocation };
	}

	const choice = await p.select({
		message: 'Hetzner Load Balancer Standort?',
		options: HETZNER_LB_LOCATIONS.map(loc => ({ value: loc, label: HETZNER_LB_LABELS[loc] })),
		initialValue: 'fsn1' as HetznerLbLocation
	});
	if (p.isCancel(choice)) {
		throw new UserCancelledError('Hetzner LB location selection aborted.');
	}
	return { lbLocation: choice };
}

function isHetznerLbLocation(value: string): value is HetznerLbLocation {
	return (HETZNER_LB_LOCATIONS as readonly string[]).includes(value);
}
