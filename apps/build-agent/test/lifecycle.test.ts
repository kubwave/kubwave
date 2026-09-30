import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeBuild } from '../src/docker';
import type { AgentTask } from '@kubwave/build-protocol';

const task: AgentTask = {
	id: 'test-run',
	attempt: 2,
	leaseToken: 'test',
	leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(),
	timeoutSeconds: 60,
	imageRef: 'registry/test:2',
	redactions: [],
	files: { workspace: {} },
	job: {
		spec: {
			template: {
				spec: {
					volumes: [{ name: 'workspace', emptyDir: {} }],
					initContainers: [{ name: 'prepare', image: 'tools', volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }] }],
					containers: [{ name: 'builder', image: 'buildkit', volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }] }]
				}
			}
		}
	}
};

test('runner checkpoints checkout before build and cleans every resource after a failed stage', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'kubwave-agent-runner-'));
	const originalPath = process.env.PATH;
	const originalRecord = process.env.DOCKER_TEST_RECORD;
	try {
		process.env.PATH = `${directory}:${originalPath}`;
		process.env.DOCKER_TEST_RECORD = join(directory, 'calls');
		await writeFile(
			join(directory, 'docker'),
			'#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_TEST_RECORD"\ncase "$1" in\ninspect) printf \'{"ExitCode":0,"OOMKilled":false}\\n\' ;;\nrun) case "$*" in *rev-parse*) printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n";; *) cat >/dev/null ;; esac ;;\nstart) case "$*" in *builder*) exit 1 ;; esac ;;\nesac\n',
			{ mode: 0o700 }
		);
		const commits: string[] = [];
		await expect(
			executeBuild(
				task,
				{ memory: '2Gi' },
				new AbortController().signal,
				() => {},
				async commit => {
					commits.push(commit);
				}
			)
		).rejects.toThrow('Container command failed');
		expect(commits).toEqual(['a'.repeat(40)]);
		const calls = await readFile(process.env.DOCKER_TEST_RECORD, 'utf8');
		expect(calls).toContain('rm --force kubwave-test-run-2-builder');
		expect(calls).toContain('rm --force kubwave-test-run-2-source');
		expect(calls).toContain('volume rm --force kubwave-test-run-2-workspace');
	} finally {
		process.env.PATH = originalPath;
		process.env.DOCKER_TEST_RECORD = originalRecord;
		await rm(directory, { recursive: true, force: true });
	}
});

test('agent reports unavailable Docker instead of exiting before its first heartbeat', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'kubwave-agent-startup-'));
	let receivedHeartbeat = false;
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 25314,
		fetch: async request => {
			const path = new URL(request.url).pathname;
			if (path.endsWith('/register')) return Response.json({ id: 'test-owner', token: 'test-credential' });
			if (path.endsWith('/heartbeat')) {
				receivedHeartbeat = true;
				const body = (await request.json()) as { dockerReady: boolean };
				expect(body.dockerReady).toBe(false);
				return Response.json({ canceled: [], leaseExpiresAt: new Date(Date.now() + 90_000).toISOString() });
			}
			return Response.json({ task: null });
		}
	});
	await writeFile(join(directory, 'docker'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
	const child = Bun.spawn([process.execPath, 'src/main.ts'], {
		cwd: join(import.meta.dir, '..'),
		env: {
			...process.env,
			PATH: `${directory}:${process.env.PATH}`,
			KUBWAVE_STATE_DIR: directory,
			KUBWAVE_URL: `http://127.0.0.1:${server.port}`,
			KUBWAVE_REGISTRATION_TOKEN: 'test-registration'
		},
		stdout: 'ignore',
		stderr: 'ignore'
	});
	try {
		for (let count = 0; count < 60 && !receivedHeartbeat; count++) await Bun.sleep(50);
		expect(receivedHeartbeat).toBe(true);
	} finally {
		child.kill('SIGKILL');
		await child.exited;
		server.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
}, 10_000);
