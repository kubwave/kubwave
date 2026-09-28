import { series } from '@/lib/mock';

export type Usage = { capacity: number; requested?: number; used: number };
export type Split = { platform: number; tenants: number; other: number };
export type ClusterResource = { id: 'cpu' | 'memory' | 'storage' | 'pods'; label: string; unit: string; usage: Usage; split: Split };

export type NodeBadge = 'Ready' | 'NotReady' | 'Cordoned' | 'MemoryPressure' | 'DiskPressure';
export type ConditionType = 'Ready' | 'MemoryPressure' | 'DiskPressure' | 'PIDPressure' | 'NetworkUnavailable';
export type NodeCondition = { type: ConditionType; status: 'True' | 'False'; reason: string; message: string; lastTransition: string };
export type PodStatus = 'Running' | 'Pending' | 'CrashLoopBackOff' | 'Completed' | 'Terminating';
export type NodePod = { namespace: string; name: string; status: PodStatus; restarts: number; cpu: number; memory: number };

export type ClusterNode = {
	name: string;
	roles: string[];
	ready: boolean;
	cordoned: boolean;
	pressure: ('MemoryPressure' | 'DiskPressure')[];
	kubelet: string;
	os: string;
	arch: string;
	kernel: string;
	runtime: string;
	ip: string;
	age: string;
	cpu: Usage;
	memory: Usage;
	pods: Usage;
	ephemeral: Usage;
	taints: string[];
	workloads: NodePod[];
	seed: number;
};

export type ClusterEvent = {
	id: string;
	type: 'Normal' | 'Warning';
	reason: string;
	message: string;
	namespace: string;
	object: string;
	count: number;
	lastSeen: string;
	node?: string;
};

export type ClusterComponent = {
	name: string;
	namespace: string;
	kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
	version: string;
	purpose: string;
	ready: number;
	desired: number;
};

export const cluster = {
	name: 'acme-prod',
	k8sVersion: 'v1.33.4+k3s1',
	uptime: '41d 6h',
	provider: 'UpCloud · fi-hel2'
};

export const clusterResources: ClusterResource[] = [
	{ id: 'cpu', label: 'CPU', unit: 'cores', usage: { capacity: 20, requested: 12.3, used: 8.9 }, split: { platform: 1.6, tenants: 6.1, other: 1.2 } },
	{
		id: 'memory',
		label: 'Memory',
		unit: 'GiB',
		usage: { capacity: 40, requested: 26.8, used: 24.8 },
		split: { platform: 5.1, tenants: 16.8, other: 2.9 }
	},
	{
		id: 'storage',
		label: 'Storage',
		unit: 'GiB',
		usage: { capacity: 480, requested: 310, used: 196 },
		split: { platform: 42, tenants: 138, other: 16 }
	},
	{ id: 'pods', label: 'Pods', unit: 'pods', usage: { capacity: 330, used: 87 }, split: { platform: 19, tenants: 58, other: 10 } }
];

export const clusterNodes: ClusterNode[] = [
	{
		name: 'cp-1',
		roles: ['control-plane', 'etcd'],
		ready: true,
		cordoned: false,
		pressure: [],
		kubelet: 'v1.33.4+k3s1',
		os: 'Ubuntu 24.04.3 LTS',
		arch: 'linux/amd64',
		kernel: '6.8.0-79-generic',
		runtime: 'containerd://2.0.5-k3s2',
		ip: '10.0.1.10',
		age: '41d',
		cpu: { capacity: 4, requested: 2.1, used: 1.4 },
		memory: { capacity: 8, requested: 5.2, used: 4.6 },
		pods: { capacity: 110, used: 17 },
		ephemeral: { capacity: 80, used: 31.4 },
		taints: ['node-role.kubernetes.io/control-plane=true:NoSchedule'],
		seed: 11,
		workloads: [
			{ namespace: 'kube-system', name: 'coredns-6799fbcd5-8kq2x', status: 'Running', restarts: 0, cpu: 12, memory: 38 },
			{ namespace: 'kube-system', name: 'metrics-server-54fd9b65b-lx7n4', status: 'Running', restarts: 1, cpu: 18, memory: 52 },
			{ namespace: 'kube-system', name: 'local-path-provisioner-6c8685-zq9f2', status: 'Running', restarts: 0, cpu: 2, memory: 14 },
			{ namespace: 'kube-system', name: 'traefik-6f4b9d7c8-t4ql8', status: 'Running', restarts: 0, cpu: 64, memory: 118 },
			{ namespace: 'kubwave', name: 'kubwave-api-7c9d8f6b5-x2kq4', status: 'Running', restarts: 0, cpu: 142, memory: 312 },
			{ namespace: 'kubwave', name: 'kubwave-console-5f7b9c6d4-p9mz2', status: 'Running', restarts: 0, cpu: 38, memory: 164 },
			{ namespace: 'kubwave', name: 'postgres-0', status: 'Running', restarts: 0, cpu: 96, memory: 842 },
			{ namespace: 'cert-manager', name: 'cert-manager-7d9f8b6c5-2mzp7', status: 'Running', restarts: 0, cpu: 4, memory: 46 },
			{ namespace: 'kubwave', name: 'kubwave-build-a41c9e2-6xk8v', status: 'Completed', restarts: 0, cpu: 0, memory: 0 }
		]
	},
	{
		name: 'worker-1',
		roles: ['worker'],
		ready: true,
		cordoned: true,
		pressure: [],
		kubelet: 'v1.33.4+k3s1',
		os: 'Ubuntu 24.04.3 LTS',
		arch: 'linux/amd64',
		kernel: '6.8.0-79-generic',
		runtime: 'containerd://2.0.5-k3s2',
		ip: '10.0.1.21',
		age: '38d',
		cpu: { capacity: 8, requested: 2.6, used: 1.9 },
		memory: { capacity: 16, requested: 6.4, used: 5.3 },
		pods: { capacity: 110, used: 14 },
		ephemeral: { capacity: 160, used: 58.2 },
		taints: ['node.kubernetes.io/unschedulable:NoSchedule'],
		seed: 23,
		workloads: [
			{ namespace: 'kube-system', name: 'svclb-traefik-5d8f2-x8x2c', status: 'Running', restarts: 0, cpu: 1, memory: 6 },
			{ namespace: 'kubwave', name: 'registry-0', status: 'Running', restarts: 0, cpu: 22, memory: 128 },
			{ namespace: 'kubwave', name: 'kubwave-worker-84bf6c9d7-m2nq5', status: 'Running', restarts: 2, cpu: 310, memory: 486 },
			{ namespace: 'storefront-production', name: 'web-7d9c8b5f6-x2kq9', status: 'Terminating', restarts: 0, cpu: 188, memory: 402 },
			{ namespace: 'blog-production', name: 'ghost-5b7c9d8f4-h7tq2', status: 'Running', restarts: 0, cpu: 46, memory: 318 },
			{ namespace: 'blog-production', name: 'mysql-0', status: 'Running', restarts: 0, cpu: 58, memory: 612 }
		]
	},
	{
		name: 'worker-2',
		roles: ['worker'],
		ready: true,
		cordoned: false,
		pressure: ['MemoryPressure'],
		kubelet: 'v1.33.4+k3s1',
		os: 'Ubuntu 24.04.3 LTS',
		arch: 'linux/amd64',
		kernel: '6.8.0-79-generic',
		runtime: 'containerd://2.0.5-k3s2',
		ip: '10.0.1.22',
		age: '38d',
		cpu: { capacity: 8, requested: 7.6, used: 5.6 },
		memory: { capacity: 16, requested: 15.2, used: 14.9 },
		pods: { capacity: 110, used: 56 },
		ephemeral: { capacity: 160, used: 102.6 },
		taints: ['node.kubernetes.io/memory-pressure:NoSchedule'],
		seed: 37,
		workloads: [
			{ namespace: 'kube-system', name: 'svclb-traefik-5d8f2-q4mnz', status: 'Running', restarts: 0, cpu: 1, memory: 6 },
			{ namespace: 'storefront-production', name: 'web-7d9c8b5f6-p9mz4', status: 'Running', restarts: 0, cpu: 412, memory: 688 },
			{ namespace: 'storefront-production', name: 'web-7d9c8b5f6-tq4l1', status: 'Running', restarts: 0, cpu: 398, memory: 702 },
			{ namespace: 'storefront-production', name: 'api-5c8d7f9b6-k2mv8', status: 'Running', restarts: 0, cpu: 624, memory: 1184 },
			{ namespace: 'storefront-production', name: 'api-5c8d7f9b6-w7xh3', status: 'Running', restarts: 1, cpu: 588, memory: 1122 },
			{ namespace: 'storefront-production', name: 'worker-6b8d7c9f5-q2lz8', status: 'CrashLoopBackOff', restarts: 14, cpu: 0, memory: 0 },
			{ namespace: 'storefront-production', name: 'postgres-0', status: 'Running', restarts: 0, cpu: 284, memory: 2410 },
			{ namespace: 'storefront-production', name: 'redis-0', status: 'Running', restarts: 0, cpu: 36, memory: 248 },
			{ namespace: 'storefront-pr-142', name: 'web-58f9c7d6b-8vn2r', status: 'Running', restarts: 0, cpu: 64, memory: 356 },
			{ namespace: 'storefront-pr-142', name: 'api-7f6d5c4b3-r5tq6', status: 'Pending', restarts: 0, cpu: 0, memory: 0 }
		]
	}
];

export const getNode = (name: string) => clusterNodes.find(n => n.name === name);

export function nodeBadges(n: Pick<ClusterNode, 'ready' | 'cordoned' | 'pressure'>): NodeBadge[] {
	return [n.ready ? 'Ready' : 'NotReady', ...(n.cordoned ? (['Cordoned'] as const) : []), ...n.pressure];
}

export function nodeConditions(n: ClusterNode): NodeCondition[] {
	const mem = n.pressure.includes('MemoryPressure');
	const disk = n.pressure.includes('DiskPressure');
	return [
		{
			type: 'Ready',
			status: n.ready ? 'True' : 'False',
			reason: n.ready ? 'KubeletReady' : 'KubeletNotReady',
			message: n.ready ? 'kubelet is posting ready status' : 'container runtime is down',
			lastTransition: n.age + ' ago'
		},
		{
			type: 'MemoryPressure',
			status: mem ? 'True' : 'False',
			reason: mem ? 'KubeletHasInsufficientMemory' : 'KubeletHasSufficientMemory',
			message: mem ? 'available memory 412Mi is below eviction threshold 500Mi' : 'kubelet has sufficient memory available',
			lastTransition: mem ? '14m ago' : n.age + ' ago'
		},
		{
			type: 'DiskPressure',
			status: disk ? 'True' : 'False',
			reason: disk ? 'KubeletHasDiskPressure' : 'KubeletHasNoDiskPressure',
			message: disk ? 'nodefs available below 10%' : 'kubelet has no disk pressure',
			lastTransition: n.age + ' ago'
		},
		{
			type: 'PIDPressure',
			status: 'False',
			reason: 'KubeletHasSufficientPID',
			message: 'kubelet has sufficient PID available',
			lastTransition: n.age + ' ago'
		},
		{ type: 'NetworkUnavailable', status: 'False', reason: 'FlannelIsUp', message: 'Flannel is running on this node', lastTransition: n.age + ' ago' }
	];
}

export const clusterComponents: ClusterComponent[] = [
	{ name: 'kubwave-api', namespace: 'kubwave', kind: 'Deployment', version: '1.7.2', purpose: 'REST API & auth', ready: 2, desired: 2 },
	{
		name: 'kubwave-worker',
		namespace: 'kubwave',
		kind: 'Deployment',
		version: '1.7.2',
		purpose: 'Reconcilers, schedulers & builds',
		ready: 1,
		desired: 1
	},
	{ name: 'kubwave-console', namespace: 'kubwave', kind: 'Deployment', version: '1.7.2', purpose: 'Web console', ready: 2, desired: 2 },
	{ name: 'traefik', namespace: 'kube-system', kind: 'Deployment', version: 'v3.3.6', purpose: 'Ingress & TCP routing', ready: 1, desired: 2 },
	{ name: 'cert-manager', namespace: 'cert-manager', kind: 'Deployment', version: 'v1.18.2', purpose: 'TLS certificates', ready: 3, desired: 3 },
	{ name: 'registry', namespace: 'kubwave', kind: 'StatefulSet', version: '2.8.3', purpose: 'Build image registry', ready: 1, desired: 1 },
	{ name: 'metrics-server', namespace: 'kube-system', kind: 'Deployment', version: 'v0.8.0', purpose: 'Resource metrics API', ready: 1, desired: 1 },
	{ name: 'postgres', namespace: 'kubwave', kind: 'StatefulSet', version: '17.6', purpose: 'Platform database', ready: 1, desired: 1 },
	{ name: 'coredns', namespace: 'kube-system', kind: 'Deployment', version: '1.12.3', purpose: 'Cluster DNS', ready: 1, desired: 1 }
];

export const clusterEvents: ClusterEvent[] = [
	{
		id: 'e1',
		type: 'Warning',
		reason: 'FailedScheduling',
		message:
			'0/3 nodes are available: 1 node(s) were unschedulable, 1 node(s) had untolerated taint {node.kubernetes.io/memory-pressure}, 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane}.',
		namespace: 'storefront-pr-142',
		object: 'pod/api-7f6d5c4b3-r5tq6',
		count: 23,
		lastSeen: '30s ago',
		node: 'worker-2'
	},
	{
		id: 'e2',
		type: 'Warning',
		reason: 'BackOff',
		message: 'Back-off restarting failed container worker in pod worker-6b8d7c9f5-q2lz8',
		namespace: 'storefront-production',
		object: 'pod/worker-6b8d7c9f5-q2lz8',
		count: 14,
		lastSeen: '1m ago',
		node: 'worker-2'
	},
	{
		id: 'e3',
		type: 'Warning',
		reason: 'EvictionThresholdMet',
		message: 'Attempting to reclaim memory',
		namespace: 'default',
		object: 'node/worker-2',
		count: 6,
		lastSeen: '2m ago',
		node: 'worker-2'
	},
	{
		id: 'e4',
		type: 'Normal',
		reason: 'Pulled',
		message: 'Successfully pulled image "registry.kubwave.svc:5000/storefront/web:a41c9e2" in 3.184s',
		namespace: 'storefront-production',
		object: 'pod/web-7d9c8b5f6-p9mz4',
		count: 1,
		lastSeen: '4m ago',
		node: 'worker-2'
	},
	{
		id: 'e5',
		type: 'Warning',
		reason: 'Unhealthy',
		message: 'Readiness probe failed: HTTP probe failed with statuscode: 503',
		namespace: 'storefront-production',
		object: 'pod/api-5c8d7f9b6-w7xh3',
		count: 4,
		lastSeen: '8m ago',
		node: 'worker-2'
	},
	{
		id: 'e6',
		type: 'Warning',
		reason: 'OOMKilling',
		message: 'Memory cgroup out of memory: Killed process 48211 (node) total-vm:2184320kB, anon-rss:1048576kB',
		namespace: 'default',
		object: 'node/worker-2',
		count: 3,
		lastSeen: '11m ago',
		node: 'worker-2'
	},
	{
		id: 'e7',
		type: 'Normal',
		reason: 'ScalingReplicaSet',
		message: 'Scaled up replica set web-7d9c8b5f6 to 3',
		namespace: 'storefront-production',
		object: 'deployment/web',
		count: 1,
		lastSeen: '12m ago'
	},
	{
		id: 'e8',
		type: 'Normal',
		reason: 'Killing',
		message: 'Stopping container web',
		namespace: 'storefront-production',
		object: 'pod/web-7d9c8b5f6-x2kq9',
		count: 1,
		lastSeen: '14m ago',
		node: 'worker-1'
	},
	{
		id: 'e9',
		type: 'Normal',
		reason: 'Issued',
		message: 'Certificate issued successfully',
		namespace: 'storefront-production',
		object: 'certificate/shop-acme-dev-tls',
		count: 1,
		lastSeen: '52m ago'
	},
	{
		id: 'e10',
		type: 'Normal',
		reason: 'NodeNotSchedulable',
		message: 'Node worker-1 status is now: NodeNotSchedulable',
		namespace: 'default',
		object: 'node/worker-1',
		count: 1,
		lastSeen: '3h ago',
		node: 'worker-1'
	},
	{
		id: 'e11',
		type: 'Normal',
		reason: 'SuccessfulCreate',
		message: 'Created pod: kubwave-build-a41c9e2-6xk8v',
		namespace: 'kubwave',
		object: 'job/kubwave-build-a41c9e2',
		count: 1,
		lastSeen: '3h ago',
		node: 'cp-1'
	},
	{
		id: 'e12',
		type: 'Normal',
		reason: 'LeaderElection',
		message: 'kubwave-worker-84bf6c9d7-m2nq5 became leader',
		namespace: 'kubwave',
		object: 'lease/kubwave-worker',
		count: 1,
		lastSeen: '5h ago'
	}
];

export type Range = '1h' | '24h' | '7d';
const NOW = Date.UTC(2026, 8, 28, 14, 30);
const rangeSpec: Record<Range, { points: number; stepMin: number }> = {
	'1h': { points: 60, stepMin: 1 },
	'24h': { points: 96, stepMin: 15 },
	'7d': { points: 84, stepMin: 120 }
};
const rangeSeed: Record<Range, number> = { '1h': 0, '24h': 17, '7d': 31 };
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

function timeline(range: Range) {
	const { points, stepMin } = rangeSpec[range];
	return Array.from({ length: points }, (_, i) => {
		const d = new Date(NOW - (points - 1 - i) * stepMin * 60_000);
		const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
		return range === '7d' ? `${days[d.getUTCDay()]} ${hm}` : hm;
	});
}

const round = (n: number) => Math.round(n * 100) / 100;

export function splitSeries(resource: 'cpu' | 'memory', range: Range) {
	const r = clusterResources.find(x => x.id === resource)!;
	const labels = timeline(range);
	const seed = (resource === 'cpu' ? 3 : 7) + rangeSeed[range];
	const p = series(seed, labels.length, r.split.platform, r.split.platform * 0.3);
	const tn = series(seed + 5, labels.length, r.split.tenants, r.split.tenants * 0.45);
	const o = series(seed + 9, labels.length, r.split.other, r.split.other * 0.4);
	return labels.map((t, i) => ({ t, platform: round(p[i]!), tenants: round(tn[i]!), other: round(o[i]!) }));
}

export function nodeSeries(node: ClusterNode, resource: 'cpu' | 'memory', range: Range) {
	const u = node[resource];
	const labels = timeline(range);
	const s = series(node.seed + (resource === 'cpu' ? 0 : 50) + rangeSeed[range], labels.length, u.used, u.used * 0.2);
	return labels.map((t, i) => ({ t, used: round(Math.min(s[i]!, u.capacity)) }));
}

export type AdminUser = {
	id: string;
	name: string;
	email: string;
	initials: string;
	role: 'admin' | 'member';
	joined: string;
	lastActive: string;
	teams: number;
};
export type Invitation = {
	id: string;
	email: string;
	role: 'admin' | 'member';
	status: 'pending' | 'accepted' | 'expired';
	invited: string;
	invitedBy: string;
};

export const adminUsers: AdminUser[] = [
	{ id: 'u1', name: 'Alex Morgan', email: 'alex@acme.dev', initials: 'AM', role: 'admin', joined: 'Mar 2, 2025', lastActive: 'Now', teams: 2 },
	{ id: 'u2', name: 'Priya Shah', email: 'priya@acme.dev', initials: 'PS', role: 'admin', joined: 'Mar 4, 2025', lastActive: '2h ago', teams: 3 },
	{ id: 'u3', name: 'Jonas Weber', email: 'jonas@acme.dev', initials: 'JW', role: 'member', joined: 'Apr 11, 2025', lastActive: '12m ago', teams: 1 },
	{ id: 'u4', name: 'Mei Lin', email: 'mei.lin@acme.dev', initials: 'ML', role: 'member', joined: 'Jun 23, 2025', lastActive: '1d ago', teams: 2 },
	{ id: 'u5', name: 'Diego Alvarez', email: 'diego@acme.dev', initials: 'DA', role: 'member', joined: 'Aug 7, 2025', lastActive: '3d ago', teams: 1 },
	{
		id: 'u6',
		name: 'Sara Kowalski',
		email: 'sara.k@acme.dev',
		initials: 'SK',
		role: 'member',
		joined: 'Nov 30, 2025',
		lastActive: '5h ago',
		teams: 2
	},
	{
		id: 'u7',
		name: 'Amara Okafor',
		email: 'amara@guild.dev',
		initials: 'AO',
		role: 'member',
		joined: 'Jan 18, 2026',
		lastActive: '2w ago',
		teams: 1
	},
	{ id: 'u8', name: 'Tom Becker', email: 'tom@acme.dev', initials: 'TB', role: 'member', joined: 'Jul 9, 2026', lastActive: '6h ago', teams: 1 }
];

export const invitations: Invitation[] = [
	{ id: 'i1', email: 'lena@acme.dev', role: 'member', status: 'pending', invited: '2d ago', invitedBy: 'Alex Morgan' },
	{ id: 'i2', email: 'ops@contractor.io', role: 'admin', status: 'pending', invited: '5h ago', invitedBy: 'Priya Shah' },
	{ id: 'i3', email: 'tom@acme.dev', role: 'member', status: 'accepted', invited: 'Jul 8, 2026', invitedBy: 'Alex Morgan' },
	{ id: 'i4', email: 'hiring@acme.dev', role: 'member', status: 'expired', invited: 'Aug 2, 2026', invitedBy: 'Priya Shah' }
];

export const platform = {
	installed: '1.7.2',
	latest: '1.8.0',
	lastChecked: '4 min ago',
	apiUptime: '12d 4h 18m',
	nodeRuntime: 'v24.8.0',
	helmChart: 'kubwave-1.7.2'
};

export type Release = { version: string; date: string; summary: string };
export const releases: Release[] = [
	{ version: '1.8.0', date: 'Sep 24, 2026', summary: 'Service references in config files, cluster monitoring dashboard, node drill-down.' },
	{ version: '1.7.2', date: 'Sep 9, 2026', summary: 'Fix PR preview host rewriting for secrets; bump Fastify and NestJS.' },
	{ version: '1.7.1', date: 'Aug 28, 2026', summary: 'UpCloud autoscaler image tag resolution; registry GC fixes.' },
	{ version: '1.7.0', date: 'Aug 12, 2026', summary: 'Gitea integration, managed Prometheus, TCP port pool.' },
	{ version: '1.6.3', date: 'Jul 21, 2026', summary: 'Security fixes for refresh token rotation.' }
];

export type UpdateRun = {
	id: string;
	from: string;
	to: string;
	status: 'succeeded' | 'failed' | 'rolled_back';
	started: string;
	duration: string;
	by: string;
};
export const updateHistory: UpdateRun[] = [
	{ id: 'h1', from: '1.7.1', to: '1.7.2', status: 'succeeded', started: 'Sep 10, 2026 09:14', duration: '2m 41s', by: 'Alex Morgan' },
	{ id: 'h2', from: '1.7.0', to: '1.7.1', status: 'succeeded', started: 'Aug 29, 2026 18:02', duration: '2m 18s', by: 'Priya Shah' },
	{ id: 'h3', from: '1.6.3', to: '1.7.0', status: 'rolled_back', started: 'Aug 13, 2026 10:47', duration: '6m 05s', by: 'Alex Morgan' },
	{ id: 'h4', from: '1.6.3', to: '1.7.0', status: 'failed', started: 'Aug 13, 2026 10:31', duration: '4m 52s', by: 'Alex Morgan' },
	{ id: 'h5', from: '1.6.2', to: '1.6.3', status: 'succeeded', started: 'Jul 22, 2026 08:20', duration: '1m 57s', by: 'Priya Shah' }
];

export const updateLog = [
	'Resolving chart kubwave-{v} from oci://ghcr.io/kubwave/charts',
	'Pulling images ghcr.io/kubwave/backend:{v}, ghcr.io/kubwave/console:{v}',
	'Rendering values (HA off, registry platform-managed)',
	'helm upgrade kubwave --namespace kubwave --atomic --wait',
	'Running database migrations (0042_service_refs, 0043_node_metrics)',
	'deployment.apps/kubwave-api rolled out (2/2)',
	'deployment.apps/kubwave-worker rolled out (1/1)',
	'deployment.apps/kubwave-console rolled out (2/2)',
	'Health check /api/health → 200 OK',
	'Update to {v} complete'
];

export type Volume = { name: string; owner: string; size: number; used: number };
export const volumes: Volume[] = [
	{ name: 'registry-storage', owner: 'kubwave · platform', size: 50, used: 38.9 },
	{ name: 'kubwave-postgres', owner: 'kubwave · platform', size: 10, used: 3.2 },
	{ name: 'postgres-data', owner: 'storefront / production', size: 20, used: 18.7 },
	{ name: 'redis-data', owner: 'storefront / production', size: 5, used: 1.1 },
	{ name: 'mysql-data', owner: 'blog / production', size: 10, used: 6.4 },
	{ name: 'ghost-content', owner: 'blog / production', size: 5, used: 2.9 }
];

export const platformSettings = {
	ha: false,
	maxDeploys: '4',
	previewLimit: '5',
	autoscale: true,
	asThreshold: '80',
	asGrowth: '25',
	asMax: '100',
	domainMode: 'wildcard',
	domainBase: 'apps.acme.dev',
	domainPattern: '{service}-{project}',
	registryMode: 'platform',
	registryUrl: '',
	registryUser: '',
	registryPassword: '',
	giteaUrl: 'https://git.acme.dev',
	giteaClientId: '6f1c2b0e-83d4-4a7e-9b51-2c0d7e4f9a13',
	giteaSecret: '',
	smtpHost: 'smtp.postmarkapp.com',
	smtpPort: '587',
	smtpTls: 'starttls',
	smtpUser: 'pm-2f8c1e',
	smtpPassword: '',
	smtpFromName: 'kubwave',
	smtpFrom: 'no-reply@acme.dev',
	metricsMode: 'managed',
	prometheusUrl: '',
	aiProvider: 'anthropic',
	aiModel: 'claude-sonnet-4-5',
	aiEndpoint: '',
	aiKey: ''
};
export type PlatformSettings = typeof platformSettings;

export const networkSettings = { tcp: true, tcpStart: '30000', tcpEnd: '30100' };

export const tcpAllocations = [
	{ port: 30001, target: 'storefront / postgres' },
	{ port: 30002, target: 'blog / mysql' },
	{ port: 30017, target: 'storefront / redis' }
];

export const appUrl = 'https://kubwave.acme.dev';
export const clusterIp = '203.0.113.10';
