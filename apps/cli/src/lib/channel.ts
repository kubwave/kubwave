export type Channel = 'stable' | 'preview';

export function isChannel(value: unknown): value is Channel {
	return value === 'stable' || value === 'preview';
}

export function parseChannel(value: string | undefined, source: string): Channel {
	if (value === undefined) {
		throw new Error(`${source} is not set`);
	}
	if (!isChannel(value)) {
		throw new Error(`${source} must be 'stable' or 'preview', got '${value}'`);
	}
	return value;
}

export interface ResolveChannelOpts {
	override?: string;
	markerChannel?: Channel;
}

export function resolveChannel(opts: ResolveChannelOpts): Channel {
	if (opts.override !== undefined) {
		return parseChannel(opts.override, '--channel');
	}
	const envChannel = process.env['KUBWAVE_CHANNEL'];
	if (envChannel !== undefined && envChannel !== '') {
		return parseChannel(envChannel, '$KUBWAVE_CHANNEL');
	}
	if (opts.markerChannel) {
		return opts.markerChannel;
	}
	return 'stable';
}
