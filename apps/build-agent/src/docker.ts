import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { BuildContainer as V1Container } from '@kubwave/build-protocol';
import { safeBuildFilePath, type AgentTask } from '@kubwave/build-protocol';

export interface BuildLimits {
	memory: string;
	cpu?: string;
}

export function memoryLimitBytes(value: string): string {
	const match = /^(\d+(?:\.\d+)?)(Mi|Gi)$/.exec(value);
	if (!match || Number(match[1]) <= 0) throw new Error('KUBWAVE_BUILD_MEMORY_LIMIT must be a positive Mi or Gi quantity');
	return String(Math.floor(Number(match[1]) * 1024 ** (match[2] === 'Gi' ? 3 : 2)));
}

export function containerArgs(container: V1Container, name: string, volumes: Map<string, string>, limits: BuildLimits): string[] {
	const command = container.command ?? [];
	return [
		'create',
		'--name',
		name,
		'--label',
		'kubwave.build-agent=true',
		'--label',
		`kubwave.agent-owner=${process.env.KUBWAVE_AGENT_ID ?? 'local'}`,
		'--memory',
		memoryLimitBytes(limits.memory),
		...(limits.cpu ? ['--cpus', limits.cpu] : []),
		...(container.securityContext?.runAsUser !== undefined
			? ['--user', `${container.securityContext.runAsUser}:${container.securityContext.runAsGroup ?? container.securityContext.runAsUser}`]
			: []),
		...(container.name === 'builder' ? ['--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined'] : []),
		...(container.workingDir ? ['--workdir', container.workingDir] : []),
		...(container.env ?? []).flatMap(entry => ['--env', `${entry.name}=${entry.value ?? ''}`]),
		...(container.volumeMounts ?? []).flatMap(mount => {
			const source = volumes.get(mount.name);
			if (!source || !mount.mountPath.startsWith('/') || mount.mountPath.includes(',')) throw new Error('Invalid build volume mount');
			return ['--mount', `type=volume,src=${source},dst=${mount.mountPath}${mount.readOnly ? ',readonly' : ''}`];
		}),
		...(command[0] ? ['--entrypoint', command[0]] : []),
		container.image!,
		...command.slice(1),
		...(container.args ?? [])
	];
}

export async function docker(
	args: string[],
	options: { signal?: AbortSignal; onLine?: (line: string) => void; input?: Buffer } = {}
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal, timeout: options.signal ? undefined : 15_000 });
		let output = '';
		const consume = (stream: NodeJS.ReadableStream) => {
			let pending = '';
			stream.on('data', (chunk: Buffer) => {
				const text = chunk.toString();
				output = (output + text).slice(-16384);
				pending += text;
				const lines = pending.split('\n');
				pending = lines.pop() ?? '';
				for (const line of lines) options.onLine?.(line.slice(0, 8192));
				if (pending.length > 8192) {
					options.onLine?.(pending.slice(0, 8192));
					pending = '';
				}
			});
			stream.on('end', () => {
				if (pending) options.onLine?.(pending);
			});
		};
		consume(child.stdout);
		consume(child.stderr);
		child.on('error', reject);
		child.on('close', code =>
			code === 0 ? resolve(output.trim()) : reject(new Error(`Container command failed (${code}): ${output.slice(-2000)}`))
		);
		child.stdin.on('error', () => {});
		child.stdin.end(options.input);
	});
}

async function archiveFiles(files: Record<string, string>): Promise<Buffer> {
	const directory = await mkdtemp(join(tmpdir(), 'kubwave-build-'));
	try {
		for (const [path, content] of Object.entries(files)) {
			const target = join(directory, safeBuildFilePath(path));
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			await writeFile(target, content, { mode: 0o600 });
		}
		return await new Promise((resolve, reject) => {
			const child = spawn('tar', ['-cf', '-', '-C', directory, '.']);
			const chunks: Buffer[] = [];
			child.stdout.on('data', chunk => chunks.push(chunk));
			child.on('error', reject);
			child.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Could not prepare build files'))));
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function executeBuild(
	task: AgentTask,
	limits: BuildLimits,
	signal: AbortSignal,
	log: (container: string, line: string) => void,
	pinSource?: (commit: string) => Promise<void>
): Promise<void> {
	const prefix = `kubwave-${task.id}-${task.attempt}`;
	const volumes = new Map<string, string>();
	const containers: string[] = [];
	const pod = task.job.spec?.template.spec;
	if (!pod) throw new Error('Build task has no stages');
	try {
		for (const volume of pod.volumes ?? []) {
			const name = `${prefix}-${volume.name}`;
			volumes.set(volume.name, name);
			await docker(
				['volume', 'create', '--label', 'kubwave.build-agent=true', '--label', `kubwave.agent-owner=${process.env.KUBWAVE_AGENT_ID}`, name],
				{ signal }
			);
			const helper = `${name}-init`;
			containers.push(helper);
			await docker(
				[
					'run',
					'--name',
					helper,
					'--label',
					'kubwave.build-agent=true',
					'--label',
					`kubwave.agent-owner=${process.env.KUBWAVE_AGENT_ID}`,
					'-i',
					'--mount',
					`type=volume,src=${name},dst=/data`,
					'--entrypoint',
					'sh',
					'alpine:3.22',
					'-ec',
					'tar -xf - -C /data; chown -R 1000:1000 /data; chmod 770 /data'
				],
				{ signal, input: await archiveFiles(task.files[volume.name] ?? {}) }
			);
		}
		for (const stage of [...(pod.initContainers ?? []), ...pod.containers]) {
			if (signal.aborted) throw new Error('Build canceled');
			const name = `${prefix}-${stage.name}`;
			containers.push(name);
			await docker(containerArgs(stage, name, volumes, limits), { signal });
			await docker(['start', '--attach', name], { signal, onLine: line => log(stage.name, line) });
			const status = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', name])) as { ExitCode: number; OOMKilled: boolean };
			if (status.OOMKilled) throw new Error(`Build ran out of memory on the external server (limit ${limits.memory}).`);
			if (status.ExitCode !== 0) throw new Error(`${stage.name} exited with code ${status.ExitCode}. Check the build logs.`);
			if (stage.name === 'prepare' && pinSource) {
				const inspectName = `${prefix}-source`;
				containers.push(inspectName);
				const commit = await docker(
					[
						'run',
						'--name',
						inspectName,
						'--label',
						`kubwave.agent-owner=${process.env.KUBWAVE_AGENT_ID}`,
						'--mount',
						`type=volume,src=${volumes.get('workspace')},dst=/workspace,readonly`,
						'--entrypoint',
						'git',
						stage.image!,
						'-C',
						'/workspace/src',
						'rev-parse',
						'HEAD'
					],
					{ signal }
				);
				await pinSource(commit.trim());
			}
		}
	} finally {
		for (const container of containers) await docker(['rm', '--force', container]).catch(() => {});
		for (const volume of volumes.values()) await docker(['volume', 'rm', '--force', volume]).catch(() => {});
	}
}

export async function cleanupOrphans(agentId: string): Promise<void> {
	for (const [kind, list] of [
		['container', ['ps', '-aq']],
		['volume', ['volume', 'ls', '-q']]
	] as const) {
		const ids = (await docker([...list, '--filter', `label=kubwave.agent-owner=${agentId}`])).split('\n').filter(Boolean);
		for (const id of ids) await docker(kind === 'container' ? ['rm', '--force', id] : ['volume', 'rm', '--force', id]);
	}
}
