import { expect, test } from 'bun:test';
import { containerArgs } from '../src/docker';

test('runs repository commands as container argv and mounts only the stage volumes', () => {
	const args = containerArgs(
		{
			name: 'prepare',
			image: 'tools:1',
			command: ['sh', '-ec', 'echo "$SOURCE_REPO_URL"'],
			env: [{ name: 'SOURCE_REPO_URL', value: 'https://git/repo;touch /host' }],
			volumeMounts: [
				{ name: 'workspace', mountPath: '/workspace' },
				{ name: 'ssh-key', mountPath: '/ssh-key', readOnly: true }
			]
		},
		'test',
		new Map([
			['workspace', 'ws'],
			['ssh-key', 'key']
		]),
		{ memory: '4Gi', cpu: '2' }
	);
	expect(args).toContain('SOURCE_REPO_URL=https://git/repo;touch /host');
	expect(args).toContain('type=volume,src=key,dst=/ssh-key,readonly');
	expect(args).not.toContain('/var/run/docker.sock');
	expect(args.slice(-3)).toEqual(['tools:1', '-ec', 'echo "$SOURCE_REPO_URL"']);
	expect(args).toContain('4294967296');
});

test('builder never receives checkout credentials', () => {
	const args = containerArgs(
		{ name: 'builder', image: 'builder:1', command: ['sh', '-ec', 'build'], volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }] },
		'test',
		new Map([
			['workspace', 'ws'],
			['ssh-key', 'key']
		]),
		{ memory: '2Gi' }
	);
	expect(args.some(arg => arg.includes('src=key'))).toBe(false);
});
