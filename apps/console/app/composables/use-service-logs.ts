import { useQuery } from '@tanstack/vue-query';
import { queryKeys } from '~/utils/query-keys';
import type { ServiceLogEntry } from '~/utils/types';

// Cap the in-session buffer so a long-lived tab can't grow without bound.
const MAX_LINES = 1000;
const DEFAULT_TAIL = 200;

export interface ServiceLogsView {
	entries: Ref<ServiceLogEntry[]>;
	pods: ComputedRef<string[]>;
	available: ComputedRef<boolean>;
	isLoading: Ref<boolean>;
}

// Dedupe key: each poll re-tails the last N lines and overlaps, so pod+timestamp+message drops the repeats.
function entryKey(e: ServiceLogEntry): string {
	return `${e.pod} ${e.timestamp ?? ''} ${e.message}`;
}

// Polls while active and follow are on, keeping a bounded de-duplicated rolling buffer; pausing keeps what's shown, pod filters to one replica.
export function useServiceLogs(
	serviceId: MaybeRefOrGetter<string | null | undefined>,
	active: MaybeRefOrGetter<boolean>,
	follow: MaybeRefOrGetter<boolean>,
	pod: MaybeRefOrGetter<string | 'all'>,
	tailLines: MaybeRefOrGetter<number> = DEFAULT_TAIL
): ServiceLogsView {
	const api = useApi();

	const { data, isPending } = useQuery({
		queryKey: computed(() => queryKeys.serviceLogs(toValue(serviceId) ?? 'none', toValue(pod), toValue(tailLines))),
		enabled: computed(() => Boolean(toValue(serviceId)) && toValue(active) && toValue(follow)),
		refetchInterval: () => (toValue(follow) ? 3000 : false),
		queryFn: async () => {
			const id = toValue(serviceId);
			const tail = toValue(tailLines);
			const podValue = toValue(pod);
			const query = podValue === 'all' ? { tailLines: tail } : { pod: podValue, tailLines: tail };
			return apiData(api.services(id!).logs.get(query)).catch(() => {
				throw new Error('Failed to load logs');
			});
		}
	});

	const entries = ref<ServiceLogEntry[]>([]);
	// Non-reactive seen-set: never rendered, so it lives in a closure variable, not a ref.
	let seen = new Set<string>();

	// Reset the buffer on service/pod change so one view never bleeds into another.
	watch([() => toValue(serviceId), () => toValue(pod)], () => {
		entries.value = [];
		seen = new Set();
	});

	// Append only unseen lines, trim to the cap, and prune the seen-set to match so it can't grow unbounded.
	watch(data, value => {
		if (!value?.available || value.entries.length === 0) return;
		const fresh = value.entries.filter(e => !seen.has(entryKey(e)));
		if (fresh.length === 0) return;
		for (const e of fresh) seen.add(entryKey(e));
		const next = [...entries.value, ...fresh].slice(-MAX_LINES);
		seen = new Set(next.map(entryKey));
		entries.value = next;
	});

	// A disabled query stays in vue-query's pending state forever, so only report loading while actually fetching — else the spinner pins permanently.
	const isLoading = computed(() => isPending.value && Boolean(toValue(serviceId)) && toValue(active) && toValue(follow));

	return {
		entries,
		pods: computed(() => data.value?.pods ?? []),
		available: computed(() => data.value?.available ?? false),
		isLoading
	};
}
