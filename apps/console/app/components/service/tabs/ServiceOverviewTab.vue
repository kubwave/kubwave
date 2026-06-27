<script setup lang="ts">
import type { Component } from 'vue';
import { Activity, Cable, CheckCircle2, Copy, ExternalLink, Globe, Key, Loader2, Server, XCircle } from 'lucide-vue-next';
import type { Service, ServiceRuntime, ServiceConfig, Deployment } from '~/utils/types';

const props = defineProps<{
	service: Service;
	runtime?: ServiceRuntime;
	latestDeployment?: Deployment | null;
}>();

const toast = useToast();

function hcEnabled(hc: ServiceConfig['healthCheck']): boolean {
	return hc?.enabled ?? false;
}

function healthCheckLabel(hc: ServiceConfig['healthCheck']): string {
	if (!hc?.enabled) return 'Not configured';
	if (hc.type === 'tcp') return `TCP :${hc.port ?? '?'}`;

	return `${hc.path ?? '/'}`;
}

function relativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60_000);

	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;

	const hours = Math.floor(mins / 60);

	if (hours < 24) return `${hours}h ago`;

	const days = Math.floor(hours / 24);

	if (days < 30) return `${days}d ago`;

	return new Date(iso).toLocaleDateString();
}

interface StatusAccent {
	border: string;
	bg: string;
}

interface StatusDot {
	dot: string;
	pulse?: boolean;
}

const STATUS_ACCENT: Record<string, StatusAccent> = {
	running: { border: 'border-l-success', bg: 'bg-linear-to-r from-success/[0.04]' },
	degraded: { border: 'border-l-warning', bg: 'bg-linear-to-r from-warning/[0.04]' },
	progressing: { border: 'border-l-info', bg: 'bg-linear-to-r from-info/[0.04]' },
	failed: { border: 'border-l-destructive', bg: 'bg-linear-to-r from-destructive/[0.04]' },
	stopped: { border: 'border-l-zinc-400', bg: 'bg-linear-to-r from-zinc-400/[0.03]' },
	unknown: { border: 'border-l-zinc-400', bg: 'bg-linear-to-r from-zinc-400/[0.03]' }
};

const STATUS_DOT: Record<string, StatusDot> = {
	running: { dot: 'bg-success' },
	degraded: { dot: 'bg-warning' },
	progressing: { dot: 'bg-info', pulse: true },
	failed: { dot: 'bg-destructive' },
	stopped: { dot: 'bg-zinc-400' },
	unknown: { dot: 'bg-zinc-400' }
};

const STATUS_LABEL: Record<string, string> = {
	running: 'Running',
	degraded: 'Degraded',
	progressing: 'Deploying',
	failed: 'Failed',
	stopped: 'Stopped',
	unknown: 'Unknown'
};

const status = computed(() => props.runtime?.status ?? 'unknown');
const accent = computed(() => STATUS_ACCENT[status.value] ?? STATUS_ACCENT.unknown!);
const dot = computed(() => STATUS_DOT[status.value] ?? STATUS_DOT.unknown!);
const statusLabel = computed(() => STATUS_LABEL[status.value] ?? 'Unknown');

const deployStatus = computed(() => props.latestDeployment?.status ?? null);
const deploymentInProgress = computed(
	() => deployStatus.value === 'pending' || deployStatus.value === 'deploying' || deployStatus.value === 'canceling'
);

const env = computed(() => props.service.config.env);
const domains = computed(() => props.service.config.domains ?? []);
const hasPort = computed(() => Boolean(props.service.config.containerPort));

interface Stat {
	icon: Component;
	label: string;
	value: string;
	iconClass: string;
}

const stats = computed<Stat[]>(() => [
	{
		icon: Cable,
		label: 'Port',
		value: props.service.config.containerPort ? `:${props.service.config.containerPort}` : 'None',
		iconClass: hasPort.value ? 'text-success' : 'text-muted-foreground'
	},
	{ icon: Key, label: 'Env vars', value: String(env.value.length), iconClass: env.value.length > 0 ? 'text-warning' : 'text-muted-foreground' },
	{
		icon: Globe,
		label: 'Domains',
		value: String(domains.value.length),
		iconClass: domains.value.length > 0 ? 'text-info' : 'text-muted-foreground'
	},
	{
		icon: Activity,
		label: 'Health check',
		value: healthCheckLabel(props.service.config.healthCheck),
		iconClass: hcEnabled(props.service.config.healthCheck) ? 'text-success' : 'text-muted-foreground'
	}
]);

// navigator.clipboard is undefined outside a secure context (e.g. a console served over plain HTTP).
async function copyText(value: string, label: string) {
	if (!navigator.clipboard) {
		toast.error('Clipboard unavailable', 'Copying needs a secure (HTTPS) context.');
		return;
	}
	try {
		await navigator.clipboard.writeText(value);
		toast.success(`${label} copied`);
	} catch {
		toast.error('Could not copy');
	}
}

function copyInternal() {
	if (props.service.internalDomain) void copyText(props.service.internalDomain, 'Internal service name');
}

function copyUrl() {
	if (props.service.defaultUrl) void copyText(props.service.defaultUrl, 'Public URL');
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<div :class="['flex items-center justify-between rounded-xl border border-l-4 bg-background px-5 py-4 shadow-xs', accent.border, accent.bg]">
			<div class="flex items-center gap-4">
				<span class="relative flex size-3">
					<span v-if="dot.pulse" :class="['absolute inline-flex size-full animate-ping rounded-full opacity-60', dot.dot]" />
					<span :class="['relative inline-flex size-3 rounded-full', dot.dot]" />
				</span>
				<div>
					<p class="text-sm font-semibold">{{ statusLabel }}</p>
					<p v-if="runtime?.desiredReplicas != null" class="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
						{{ runtime.readyReplicas ?? 0 }}/{{ runtime.desiredReplicas }} replicas ready
					</p>
				</div>
			</div>

			<div class="text-right">
				<template v-if="deployStatus">
					<p class="text-xs text-muted-foreground">Latest deploy</p>
					<p class="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
						<CheckCircle2 v-if="deployStatus === 'succeeded'" class="size-3.5 text-success" />
						<XCircle v-else-if="deployStatus === 'failed'" class="size-3.5 text-destructive" />
						<Loader2 v-else-if="deploymentInProgress" class="size-3.5 animate-spin text-info" />
						<XCircle v-else class="size-3.5 text-muted-foreground" />
						{{ deployStatus }}
						<span v-if="latestDeployment?.createdAt" class="font-normal text-muted-foreground">{{ relativeTime(latestDeployment.createdAt) }}</span>
					</p>
				</template>
				<p v-else class="text-xs text-muted-foreground">Not yet deployed</p>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div v-for="stat in stats" :key="stat.label" class="rounded-xl bg-muted/30 px-4 py-3">
				<component :is="stat.icon" :class="['mb-1.5 size-4', stat.iconClass]" />
				<p class="text-sm font-semibold">{{ stat.value }}</p>
				<p class="mt-0.5 text-xs text-muted-foreground">{{ stat.label }}</p>
			</div>
		</div>

		<div class="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-3">
			<Server class="size-4 shrink-0 text-muted-foreground" />
			<template v-if="service.internalDomain">
				<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{{ service.internalDomain }}</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-7 shrink-0 text-muted-foreground"
					aria-label="Copy internal service name"
					@click="copyInternal"
				>
					<Copy />
				</Button>
			</template>
			<span v-else class="text-xs text-muted-foreground">Set a port to create an internal service name</span>
		</div>

		<div v-if="service.defaultUrl" class="flex items-center gap-3 rounded-xl bg-muted/30 px-4 py-3">
			<Globe class="size-4 shrink-0 text-success" />
			<a
				:href="service.defaultUrl"
				target="_blank"
				rel="noreferrer"
				class="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80 hover:text-foreground hover:underline"
			>
				{{ service.defaultUrl.replace(/^https?:\/\//, '') }}
			</a>
			<Button type="button" variant="ghost" size="icon" class="size-7 shrink-0 text-muted-foreground" aria-label="Copy public URL" @click="copyUrl">
				<Copy />
			</Button>
			<a
				:href="service.defaultUrl"
				target="_blank"
				rel="noreferrer"
				aria-label="Open public URL"
				class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<ExternalLink class="size-3.5" />
			</a>
		</div>

		<div v-if="env.length > 0" class="rounded-xl bg-muted/30 px-4 py-3">
			<p class="mb-2 text-xs font-medium text-muted-foreground">Environment variables</p>
			<div class="flex flex-wrap gap-1.5">
				<Badge v-for="entry in env.slice(0, 3)" :key="entry.key" variant="secondary" class="font-mono text-[0.7rem]">{{ entry.key }}</Badge>
				<Badge v-if="env.length > 3" variant="secondary" class="text-[0.7rem]">+{{ env.length - 3 }} more</Badge>
			</div>
		</div>

		<div v-if="domains.length > 0" class="rounded-xl bg-muted/30 px-4 py-3">
			<p class="mb-2 text-xs font-medium text-muted-foreground">Domains</p>
			<div class="flex flex-col gap-1.5">
				<div v-for="(d, i) in domains.slice(0, 3)" :key="i" class="flex items-center gap-2 font-mono text-xs">
					<Globe class="size-3 text-muted-foreground" />
					<span class="text-foreground/80">{{ d.host }}</span>
					<span class="text-muted-foreground">:{{ d.port }}</span>
				</div>
				<p v-if="domains.length > 3" class="text-xs text-muted-foreground">+{{ domains.length - 3 }} more domains</p>
			</div>
		</div>
	</div>
</template>
