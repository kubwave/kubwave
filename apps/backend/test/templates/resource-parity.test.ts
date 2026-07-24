import { describe, expect, test } from 'bun:test';
import { resourceConfigSchema } from '~/modules/services/services.dto';
import { templateResourcesSchema } from '@kubwave/templates';

// Verify that the CPU and memory regex patterns in the templates schema
// match the backend resourceConfigSchema regex patterns. This guards against
// divergence if either schema's regexes are ever updated.
describe('Resource schema parity', () => {
	// Test values that should be accepted by both CPU validation regexes
	const validCpuValues = ['250m', '1', '0.5', '1000m'];
	// Test values that should be rejected by both CPU validation regexes
	const invalidCpuValues = ['250x', 'abc', '', '1Gi'];

	// Test values that should be accepted by both memory validation regexes
	const validMemoryValues = ['512Mi', '1Gi', '256Mi'];
	// Test values that should be rejected by both memory validation regexes
	const invalidMemoryValues = ['512', 'abc', '', '250m'];

	test('cpuRequest parity: accepted values', () => {
		validCpuValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ cpuRequest: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ cpuRequest: value }).success;
			expect(templateResult, `cpuRequest="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});

	test('cpuRequest parity: rejected values', () => {
		invalidCpuValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ cpuRequest: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ cpuRequest: value }).success;
			expect(templateResult, `cpuRequest="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});

	test('cpuLimit parity: accepted values', () => {
		validCpuValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ cpuLimit: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ cpuLimit: value }).success;
			expect(templateResult, `cpuLimit="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});

	test('cpuLimit parity: rejected values', () => {
		invalidCpuValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ cpuLimit: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ cpuLimit: value }).success;
			expect(templateResult, `cpuLimit="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});

	test('memoryRequest parity: accepted values', () => {
		validMemoryValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ memoryRequest: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ memoryRequest: value }).success;
			expect(templateResult, `memoryRequest="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});

	test('memoryRequest parity: rejected values', () => {
		invalidMemoryValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ memoryRequest: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ memoryRequest: value }).success;
			expect(templateResult, `memoryRequest="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});

	test('memoryLimit parity: accepted values', () => {
		validMemoryValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ memoryLimit: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ memoryLimit: value }).success;
			expect(templateResult, `memoryLimit="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});

	test('memoryLimit parity: rejected values', () => {
		invalidMemoryValues.forEach(value => {
			const templateResult = templateResourcesSchema.safeParse({ memoryLimit: value }).success;
			const backendResult = resourceConfigSchema.safeParse({ memoryLimit: value }).success;
			expect(templateResult, `memoryLimit="${value}" diverged: template=${templateResult} vs backend=${backendResult}`).toBe(backendResult);
		});
	});
});
