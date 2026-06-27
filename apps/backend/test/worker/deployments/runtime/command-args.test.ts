import { describe, expect, test } from 'bun:test';
import type { Deployment, DockerImageServiceConfig } from '@kubwave/db';
import { buildDeployment, deploymentMatchesConfig } from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const IMAGE_REF = 'supabase/edge-runtime:v1.71.2';
const deployment = { serviceId: SERVICE_ID } as Deployment;

// Container entrypoint override is the edge-runtime shape: `start --main-service ...` as command, extra flags as args.
function configWith(overrides: Partial<Pick<DockerImageServiceConfig, 'command' | 'args'>>): DockerImageServiceConfig {
	return { image: 'supabase/edge-runtime', tag: 'v1.71.2', containerPort: 9000, env: [], secrets: [], domains: [], volumes: [], ...overrides };
}

function container(config: DockerImageServiceConfig) {
	return buildDeployment(deployment, NAMESPACE, config, IMAGE_REF).spec!.template!.spec!.containers[0]!;
}

describe('buildDeployment command/args', () => {
	test('renders command and args on the container when set', () => {
		const c = container(configWith({ command: ['start', '--main-service', '/home/deno/functions/main'], args: ['--verbose'] }));
		expect(c.command).toEqual(['start', '--main-service', '/home/deno/functions/main']);
		expect(c.args).toEqual(['--verbose']);
	});

	test('omits command/args from the container spec when absent', () => {
		const c = container(configWith({}));
		expect(c.command).toBeUndefined();
		expect(c.args).toBeUndefined();
	});

	test('treats empty arrays as absent — the fields are omitted, not rendered empty', () => {
		const c = container(configWith({ command: [], args: [] }));
		expect(c.command).toBeUndefined();
		expect(c.args).toBeUndefined();
	});
});

describe('deploymentMatchesConfig with command/args', () => {
	test('a converged Deployment matches its own config', () => {
		const config = configWith({ command: ['start', '--main-service', '/home/deno/functions/main'], args: ['--verbose'] });
		const built = buildDeployment(deployment, NAMESPACE, config, IMAGE_REF);
		expect(deploymentMatchesConfig(built, config, IMAGE_REF, SERVICE_ID)).toBe(true);
	});

	test('a changed command is a mismatch', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith({ command: ['start', 'a'] }), IMAGE_REF);
		const next = configWith({ command: ['start', 'b'] });
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	// command/args are argv — order is significant, so reordering must roll the Deployment (unlike env/volumes, which sort).
	test('reordered args are a mismatch', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith({ args: ['--a', '--b'] }), IMAGE_REF);
		const next = configWith({ args: ['--b', '--a'] });
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	test('adding a command is a mismatch', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith({}), IMAGE_REF);
		const next = configWith({ command: ['start'] });
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	// Empty arrays and absent are the same shape: a Deployment built without command/args must still match a config carrying [].
	test('empty arrays match a Deployment built without command/args', () => {
		const built = buildDeployment(deployment, NAMESPACE, configWith({}), IMAGE_REF);
		const next = configWith({ command: [], args: [] });
		expect(deploymentMatchesConfig(built, next, IMAGE_REF, SERVICE_ID)).toBe(true);
	});
});
