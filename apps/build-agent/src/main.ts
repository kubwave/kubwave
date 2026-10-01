import { mkdir, readFile, writeFile, rename, statfs } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { AGENT_HEARTBEAT_MS, BUILD_PROTOCOL_VERSION, redactBuildLog, type AgentTask, type AgentLogLine } from '@kubwave/build-protocol';
import { AgentApi, AgentApiError } from './api.js';
import { cleanupOrphans, docker, executeBuild, memoryLimitBytes } from './docker.js';

const stateDirectory = process.env.KUBWAVE_STATE_DIR ?? '/var/lib/kubwave-agent';
const url = process.env.KUBWAVE_URL;
if (!url) throw new Error('KUBWAVE_URL is required');
const limits = { memory: process.env.KUBWAVE_BUILD_MEMORY_LIMIT ?? '2Gi', cpu: process.env.KUBWAVE_BUILD_CPU_LIMIT };
memoryLimitBytes(limits.memory);
if (limits.cpu && (!/^\d+(?:\.\d+)?$/.test(limits.cpu) || Number(limits.cpu) <= 0)) throw new Error('KUBWAVE_BUILD_CPU_LIMIT must be positive');
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
const credentialsPath = join(stateDirectory, 'credentials.json');
let credentials: { id: string; token: string };
try {
	credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	const token = process.env.KUBWAVE_REGISTRATION_TOKEN;
	if (!token) throw new Error('A registration token is required on first start');
	credentials = await new AgentApi(url).post('register', { token });
	await writeFile(`${credentialsPath}.tmp`, JSON.stringify(credentials), { mode: 0o600 });
	await rename(`${credentialsPath}.tmp`, credentialsPath);
}
delete process.env.KUBWAVE_REGISTRATION_TOKEN;
process.env.KUBWAVE_AGENT_ID = credentials.id;
const api = new AgentApi(url, credentials.token);
let cleanedOrphans = false;

type ActiveTask = {
	task: AgentTask;
	controller: AbortController;
	logs: AgentLogLine[];
	nextSequence: number;
	droppedLogs: number;
	flushing?: Promise<void>;
	result?: { success: boolean; error?: string };
};
const active = new Map<string, ActiveTask>();
const leaseWatchdog = setInterval(() => {
	for (const build of active.values()) if (Date.parse(build.task.leaseExpiresAt) - 10_000 <= Date.now()) build.controller.abort();
}, 1000);
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'])
	process.on(signal, () => {
		stopping = true;
		for (const build of active.values()) build.controller.abort();
	});

async function flush(build: ActiveTask): Promise<void> {
	if (build.flushing) return build.flushing;
	if (!build.logs.length) return;
	const lines = build.logs.slice(0, 100);
	if (build.droppedLogs) {
		lines[0] = {
			...lines[0]!,
			message: `[${build.droppedLogs} earlier log lines were dropped while the server was unavailable]\n${lines[0]!.message}`.slice(0, 8192)
		};
	}
	const dropped = build.droppedLogs;
	build.flushing = api
		.post(`tasks/${build.task.id}/logs`, { attempt: build.task.attempt, leaseToken: build.task.leaseToken, lines })
		.then(() => {
			const acknowledged = lines.at(-1)!.sequence;
			build.logs = build.logs.filter(line => line.sequence > acknowledged);
			build.droppedLogs = Math.max(0, build.droppedLogs - dropped);
		})
		.finally(() => {
			build.flushing = undefined;
		});
	return build.flushing;
}
const logPump = setInterval(() => {
	for (const build of active.values()) void flush(build).catch(() => {});
}, 1000);

function start(task: AgentTask): void {
	const controller = new AbortController();
	const build: ActiveTask = { task, controller, logs: [], nextSequence: 0, droppedLogs: 0 };
	active.set(task.id, build);
	const timer = setTimeout(() => controller.abort(), task.timeoutSeconds * 1000);
	void executeBuild(
		task,
		limits,
		controller.signal,
		(container, line) => {
			if (build.logs.length >= 512) {
				build.logs.shift();
				build.droppedLogs++;
			}
			build.logs.push({
				sequence: build.nextSequence++,
				container,
				message: redactBuildLog(line, task.redactions).slice(0, 8192),
				ts: new Date().toISOString()
			});
		},
		commit => api.post(`tasks/${task.id}/source`, { attempt: task.attempt, leaseToken: task.leaseToken, commit }).then(() => {})
	)
		.then(
			() => {
				build.result = { success: true };
			},
			error => {
				build.result = {
					success: false,
					error: redactBuildLog(error instanceof Error ? error.message : 'Build failed', task.redactions).slice(0, 2000)
				};
			}
		)
		.finally(() => clearTimeout(timer));
}

console.log('kubwave build agent started');
while (!stopping || active.size) {
	for (const build of active.values()) if (Date.parse(build.task.leaseExpiresAt) - 10_000 <= Date.now()) build.controller.abort();
	try {
		const disk = await statfs(stateDirectory);
		const dockerReady = await docker(['info', '--format', '{{.ServerVersion}}']).then(
			() => true,
			() => false
		);
		if (dockerReady && !cleanedOrphans) {
			await cleanupOrphans(credentials.id);
			cleanedOrphans = true;
		}
		const heartbeat = await api.post<{ canceled: string[]; leaseExpiresAt: string }>('heartbeat', {
			protocolVersion: BUILD_PROTOCOL_VERSION,
			version: process.env.KUBWAVE_VERSION ?? 'dev',
			architecture: process.arch === 'arm64' ? 'arm64' : 'amd64',
			cpus: cpus().length,
			memoryBytes: totalmem(),
			freeDiskBytes: disk.bavail * disk.bsize,
			dockerReady,
			tasks: [...active.values()].map(({ task }) => ({ id: task.id, attempt: task.attempt, leaseToken: task.leaseToken }))
		});
		for (const build of active.values()) {
			if (heartbeat.canceled.includes(build.task.id)) {
				build.controller.abort();
				if (build.result) active.delete(build.task.id);
				continue;
			}
			build.task.leaseExpiresAt = heartbeat.leaseExpiresAt;
			if (build.result && !build.logs.length && !build.flushing) {
				await api.post(`tasks/${build.task.id}/result`, { attempt: build.task.attempt, leaseToken: build.task.leaseToken, ...build.result });
				active.delete(build.task.id);
			}
		}
		if (!stopping && dockerReady) {
			for (let count = active.size; count < 32; count++) {
				const { task } = await api.post<{ task: AgentTask | null }>('claim');
				if (!task) break;
				start(task);
			}
		}
	} catch (error) {
		console.error(error instanceof AgentApiError ? error.message : 'Could not contact kubwave; retrying');
		if (error instanceof AgentApiError && error.status === 401) {
			stopping = true;
			for (const build of active.values()) build.controller.abort();
		}
	}
	for (const [id, build] of active)
		if (build.controller.signal.aborted && build.result && (stopping || Date.parse(build.task.leaseExpiresAt) <= Date.now())) active.delete(id);
	if (stopping && !active.size) break;
	await new Promise(resolve => setTimeout(resolve, AGENT_HEARTBEAT_MS));
}

clearInterval(leaseWatchdog);
clearInterval(logPump);
