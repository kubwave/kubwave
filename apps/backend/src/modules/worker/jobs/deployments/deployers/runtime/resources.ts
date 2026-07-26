import type { V1ResourceRequirements } from '@kubernetes/client-node';
import type { ResourceConfig, RuntimeConfig } from '@kubwave/db';

// Container resources from the four optional quantity strings; each unset field falls back to the cluster-wide default so every tenant pod reserves a scheduling baseline (spreads pods + gives the cluster-autoscaler a signal). Returns undefined when nothing resolves.
export function buildResources(resources: ResourceConfig | undefined, defaults?: ResourceConfig): V1ResourceRequirements | undefined {
	const requests: Record<string, string> = {};
	const limits: Record<string, string> = {};
	// Blank per-service values are unset, not explicit overrides, so the cluster default still applies.
	const present = (v: string | undefined): string | undefined => (v != null && v.trim() !== '' ? v : undefined);
	const cpuRequest = present(resources?.cpuRequest) ?? defaults?.cpuRequest;
	const memoryRequest = present(resources?.memoryRequest) ?? defaults?.memoryRequest;
	const cpuLimit = present(resources?.cpuLimit) ?? defaults?.cpuLimit;
	const memoryLimit = present(resources?.memoryLimit) ?? defaults?.memoryLimit;
	if (cpuRequest) requests.cpu = cpuRequest;
	if (memoryRequest) requests.memory = memoryRequest;
	if (cpuLimit) limits.cpu = cpuLimit;
	if (memoryLimit) limits.memory = memoryLimit;
	const out: V1ResourceRequirements = {};
	if (Object.keys(requests).length > 0) out.requests = requests;
	if (Object.keys(limits).length > 0) out.limits = limits;
	return out.requests || out.limits ? out : undefined;
}

const NANO = 1_000_000_000n;
// Quantity suffixes scaled to nano-units. Doubles lose exactness at Gi scale, so the arithmetic is BigInt.
const SUFFIX_MULTIPLIER: Record<string, bigint> = {
	n: 1n,
	u: 1_000n,
	m: 1_000_000n,
	'': NANO,
	k: NANO * 1_000n,
	M: NANO * 1_000_000n,
	G: NANO * 1_000_000_000n,
	T: NANO * 1_000_000_000_000n,
	P: NANO * 1_000_000_000_000_000n,
	E: NANO * 1_000_000_000_000_000_000n,
	Ki: NANO * 1024n,
	Mi: NANO * 1024n ** 2n,
	Gi: NANO * 1024n ** 3n,
	Ti: NANO * 1024n ** 4n,
	Pi: NANO * 1024n ** 5n,
	Ei: NANO * 1024n ** 6n
};
// Mirrors the apimachinery grammar: `<digits>`, `<digits>.<digits>`, `<digits>.` or `.<digits>`,
// then at most one suffix — a decimal exponent XOR an SI/binary suffix, never both (`1e3Ki` is not
// a quantity). `E` is exa on its own and an exponent marker only when digits follow it.
const QUANTITY_PATTERN = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+)|(Ki|Mi|Gi|Ti|Pi|Ei|[numkMGTPE]))?$/;
// Past this the value is far outside the int64 range a quantity can hold, and 10n ** exponent would
// allocate for a string the API server would reject anyway.
const MAX_EXPONENT = 100;

// Value of a quantity string in nano-units, or null when it isn't one we can compare numerically.
function parseQuantity(value: string): bigint | null {
	const match = QUANTITY_PATTERN.exec(value.trim());
	if (!match) return null;
	const [, sign, digits = '', exponent, suffix = ''] = match;
	const multiplier = SUFFIX_MULTIPLIER[suffix];
	if (multiplier == null) return null;
	const [whole = '', fraction = ''] = digits.split('.');
	const power = exponent ? Number(exponent) : 0;
	if (Math.abs(power) > MAX_EXPONENT) return null;
	let scaled = BigInt(whole + fraction) * multiplier;
	let divisor = 10n ** BigInt(fraction.length);
	if (power >= 0) scaled *= 10n ** BigInt(power);
	else divisor *= 10n ** BigInt(-power);
	// Finer than nano-units: not representable here, so let the caller fall back to string equality.
	if (scaled % divisor !== 0n) return null;
	return (sign === '-' ? -1n : 1n) * (scaled / divisor);
}

// The API server stores quantities canonicalized, so a written `1000m` reads back as `1`. Comparing
// the raw strings would never converge and the reconciler would rewrite the Deployment every tick.
function quantitiesEqual(existing: string, desired: string): boolean {
	if (existing === desired) return true;
	const a = parseQuantity(existing);
	const b = parseQuantity(desired);
	return a != null && b != null && a === b;
}

// True when the live resources reflect config; compares only the four cpu/memory request+limit fields (each with the same default fallback as buildResources) so the reconciler neither flaps nor misses a default rollout.
export function resourcesMatch(container: { resources?: V1ResourceRequirements }, config: RuntimeConfig, defaults?: ResourceConfig): boolean {
	const desired = buildResources(config.resources, defaults);
	const existing = container.resources;
	const get = (r: V1ResourceRequirements | undefined, kind: 'requests' | 'limits', key: 'cpu' | 'memory'): string =>
		(r?.[kind] as Record<string, string> | undefined)?.[key] ?? '';
	return (
		quantitiesEqual(get(existing, 'requests', 'cpu'), get(desired, 'requests', 'cpu')) &&
		quantitiesEqual(get(existing, 'requests', 'memory'), get(desired, 'requests', 'memory')) &&
		quantitiesEqual(get(existing, 'limits', 'cpu'), get(desired, 'limits', 'cpu')) &&
		quantitiesEqual(get(existing, 'limits', 'memory'), get(desired, 'limits', 'memory'))
	);
}
