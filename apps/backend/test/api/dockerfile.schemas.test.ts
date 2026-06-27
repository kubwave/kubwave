import { describe, expect, test } from 'bun:test';
import { createServiceSchema, dockerfileConfigSchema } from '~/modules/services/services.dto';

const baseConfig = { dockerfile: 'FROM nginx:1.27-alpine', containerPort: 80, env: [] };

describe('dockerfileConfigSchema', () => {
	test('accepts a self-contained Dockerfile', () => {
		expect(dockerfileConfigSchema.safeParse(baseConfig).success).toBe(true);
	});

	test('rejects an empty Dockerfile', () => {
		expect(dockerfileConfigSchema.safeParse({ ...baseConfig, dockerfile: '   ' }).success).toBe(false);
	});

	test('requires a FROM instruction', () => {
		const result = dockerfileConfigSchema.safeParse({ ...baseConfig, dockerfile: 'RUN echo hi\nCMD ["sh"]' });
		expect(result.success).toBe(false);
		const messages = result.success ? [] : result.error.issues.map(i => i.message);
		expect(messages.some(m => m.includes('FROM'))).toBe(true);
	});

	test('accepts a multi-stage Dockerfile (COPY --from is fine)', () => {
		const dockerfile = 'FROM golang:1.23 AS build\nRUN go build -o /app\nFROM alpine:3.20\nCOPY --from=build /app /app\nCMD ["/app"]';
		expect(dockerfileConfigSchema.safeParse({ ...baseConfig, dockerfile }).success).toBe(true);
	});

	test('still enforces the shared runtime rules (autoscaling + volume are exclusive)', () => {
		const result = dockerfileConfigSchema.safeParse({
			...baseConfig,
			resources: { cpuRequest: '250m' },
			volumes: [{ name: 'data', mountPath: '/data', size: '1Gi' }],
			autoscaling: { enabled: true, maxReplicas: 3, targetCpuUtilizationPercentage: 70 }
		});
		expect(result.success).toBe(false);
		const messages = result.success ? [] : result.error.issues.map(i => i.message);
		expect(messages.some(m => m.includes('persistent volume'))).toBe(true);
	});
});

describe('createServiceSchema (discriminated on type)', () => {
	test('a dockerfile service validates against the dockerfile config', () => {
		const result = createServiceSchema.safeParse({ name: 'web', type: 'dockerfile', config: baseConfig });
		expect(result.success).toBe(true);
	});

	test('a dockerfile service rejects an image config (no dockerfile)', () => {
		const result = createServiceSchema.safeParse({
			name: 'web',
			type: 'dockerfile',
			config: { image: 'nginx', tag: 'latest', containerPort: 80, env: [] }
		});
		expect(result.success).toBe(false);
	});

	test('a docker-image service still validates against the image config', () => {
		const result = createServiceSchema.safeParse({
			name: 'web',
			type: 'docker-image',
			config: { image: 'nginx', tag: 'latest', containerPort: 80, env: [] }
		});
		expect(result.success).toBe(true);
	});

	test('rejects an unknown service type', () => {
		expect(createServiceSchema.safeParse({ name: 'web', type: 'totally-made-up', config: baseConfig }).success).toBe(false);
	});
});
