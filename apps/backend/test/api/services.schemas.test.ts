import { describe, expect, test } from 'bun:test';
import { dockerImageConfigSchema } from '~/modules/services/services.dto';

const base = {
	image: 'nginx',
	tag: 'latest',
	containerPort: 8080,
	env: [],
	domains: []
};

const volume = { name: 'data', mountPath: '/data', size: '1Gi' };
const autoscaling = { enabled: true, maxReplicas: 5, targetCpuUtilizationPercentage: 70 };
const resources = { cpuRequest: '250m' };

// A persistent volume pins a service to one instance, so the schema rejects also enabling autoscaling (would wedge replicas on Multi-Attach).
describe('dockerImageConfigSchema: volume + autoscaling are mutually exclusive', () => {
	test('rejects autoscaling enabled together with a volume', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, resources, volumes: [volume], autoscaling });
		expect(result.success).toBe(false);
		const messages = result.success ? [] : result.error.issues.map(i => i.message);
		expect(messages.some(m => m.includes('persistent volume'))).toBe(true);
	});

	test('accepts a volume without autoscaling', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, volumes: [volume] });
		expect(result.success).toBe(true);
	});

	test('accepts autoscaling without a volume', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, resources, volumes: [], autoscaling });
		expect(result.success).toBe(true);
	});

	test('accepts autoscaling disabled alongside a volume', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, volumes: [volume], autoscaling: { enabled: false } });
		expect(result.success).toBe(true);
	});

	test('accepts explicit default-domain opt-in', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, volumes: [], defaultDomainEnabled: true });
		expect(result.success).toBe(true);
	});
});

// subPath must be a clean relative path so it can't escape the volume or drift against the kubelet's normalized form.
describe('serviceVolumeSchema: subPath validation', () => {
	const withSubPath = (subPath: string) => dockerImageConfigSchema.safeParse({ ...base, volumes: [{ ...volume, subPath }] });

	test('accepts a clean relative subPath (single and nested segments)', () => {
		expect(withSubPath('pgdata').success).toBe(true);
		expect(withSubPath('a/b/c').success).toBe(true);
	});

	test('omitting subPath is valid (the field is optional)', () => {
		expect(dockerImageConfigSchema.safeParse({ ...base, volumes: [volume] }).success).toBe(true);
	});

	test.each([
		['leading slash', '/pgdata'],
		['parent traversal', '../escape'],
		['embedded traversal', 'a/../b'],
		['single-dot segment', './pgdata'],
		['trailing slash', 'pgdata/'],
		['double slash', 'a//b'],
		['whitespace only', '   '],
		['inner whitespace segment', 'a/ /b']
	])('rejects %s', (_label, subPath) => {
		expect(withSubPath(subPath).success).toBe(false);
	});
});

// Each file maps to a distinct Secret key: collisions silently drop a file and an oversized set overflows the 1 MiB Secret, so both are rejected.
describe('dockerImageConfigSchema: config files', () => {
	const file = (path: string, content = 'x') => ({ path, content });

	test('accepts distinct, absolute paths', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, configFiles: [file('/etc/a.yml'), file('/etc/b.yml')] });
		expect(result.success).toBe(true);
	});

	test('rejects duplicate paths', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, configFiles: [file('/etc/a.yml'), file('/etc/a.yml')] });
		expect(result.success).toBe(false);
		const messages = result.success ? [] : result.error.issues.map(i => i.message);
		expect(messages.some(m => m.includes('unique path'))).toBe(true);
	});

	test('rejects distinct paths that collide on the derived Secret key', () => {
		// /a/b and /a_b both map to fileKey "a_b" — one would silently overwrite the other in the Secret.
		const result = dockerImageConfigSchema.safeParse({ ...base, configFiles: [file('/a/b'), file('/a_b')] });
		expect(result.success).toBe(false);
		const messages = result.success ? [] : result.error.issues.map(i => i.message);
		expect(messages.some(m => m.includes('same mounted file'))).toBe(true);
	});

	test('rejects a path containing ".."', () => {
		const result = dockerImageConfigSchema.safeParse({ ...base, configFiles: [file('/etc/../secret')] });
		expect(result.success).toBe(false);
	});

	test('rejects config files exceeding the total size limit', () => {
		// Each file stays under the 128 KiB per-file cap, but 8 × 120 KiB overflows the ~900 KB total.
		const result = dockerImageConfigSchema.safeParse({
			...base,
			configFiles: Array.from({ length: 8 }, (_, i) => file(`/etc/f${i}.yml`, 'a'.repeat(120 * 1024)))
		});
		expect(result.success).toBe(false);
		const messages = result.success ? [] : result.error.issues.map(i => i.message);
		expect(messages.some(m => m.includes('total size limit'))).toBe(true);
	});
});
