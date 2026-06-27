import { describe, expect, test } from 'bun:test';
import type { Deployment, DockerImageServiceConfig } from '@kubwave/db';
import { buildDeployment, deploymentMatchesConfig } from '~/modules/worker/jobs/deployments/deployers/runtime/deployment';

const SERVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NAMESPACE = 'kubwave-env-1';
const IMAGE_REF = 'nginx:1.27';
const deployment = { serviceId: SERVICE_ID } as Deployment;

function config(): DockerImageServiceConfig {
	return { image: 'nginx', tag: '1.27', containerPort: 80, env: [], secrets: [], domains: [], volumes: [] };
}

function podSpec(opts?: { podSecurityEnforce?: string; runtimeClass?: string }) {
	return buildDeployment(deployment, NAMESPACE, config(), IMAGE_REF, opts).spec!.template!.spec!;
}

describe('buildDeployment tenant pod hardening', () => {
	test('blocks privilege escalation on every tenant container, at every level', () => {
		expect(podSpec({ podSecurityEnforce: 'baseline' }).containers[0]!.securityContext?.allowPrivilegeEscalation).toBe(false);
		expect(podSpec({ podSecurityEnforce: 'restricted' }).containers[0]!.securityContext?.allowPrivilegeEscalation).toBe(false);
	});

	test('does NOT drop capabilities under baseline, so root-then-drop images (nginx, postgres) keep working', () => {
		const c = podSpec({ podSecurityEnforce: 'baseline' }).containers[0]!;
		expect(c.securityContext?.capabilities).toBeUndefined();
	});

	test('drops ALL capabilities and re-adds only NET_BIND_SERVICE under restricted', () => {
		const c = podSpec({ podSecurityEnforce: 'restricted' }).containers[0]!;
		expect(c.securityContext?.capabilities?.drop).toEqual(['ALL']);
		expect(c.securityContext?.capabilities?.add).toEqual(['NET_BIND_SERVICE']);
	});

	test('pod keeps the seccomp sandbox and does NOT pin runAsNonRoot under baseline (root images keep working)', () => {
		const spec = podSpec({ podSecurityEnforce: 'baseline' });
		expect(spec.securityContext?.seccompProfile?.type).toBe('RuntimeDefault');
		expect(spec.securityContext?.runAsNonRoot).toBeUndefined();
	});

	test('pod pins runAsNonRoot under restricted so the generated spec passes restricted admission', () => {
		const spec = podSpec({ podSecurityEnforce: 'restricted' });
		expect(spec.securityContext?.runAsNonRoot).toBe(true);
		expect(spec.securityContext?.seccompProfile?.type).toBe('RuntimeDefault');
	});
});

describe('deploymentMatchesConfig with hardening', () => {
	test('a freshly built Deployment matches its own config', () => {
		const cfg = config();
		const built = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF);
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID)).toBe(true);
	});

	test('a pre-hardening Deployment (no container securityContext) is a mismatch, so it rolls once', () => {
		const cfg = config();
		const built = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF);
		delete built.spec!.template!.spec!.containers[0]!.securityContext;
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID)).toBe(false);
	});

	test('under restricted, a baseline-built Deployment (no runAsNonRoot/capabilities) is a mismatch and rolls to add them', () => {
		const cfg = config();
		const builtBaseline = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF, { podSecurityEnforce: 'baseline' });
		expect(deploymentMatchesConfig(builtBaseline, cfg, IMAGE_REF, SERVICE_ID, 'restricted')).toBe(false);
	});

	test('switching restricted->baseline is a mismatch and rolls once to drop the capabilities/runAsNonRoot', () => {
		const cfg = config();
		const builtRestricted = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF, { podSecurityEnforce: 'restricted' });
		expect(deploymentMatchesConfig(builtRestricted, cfg, IMAGE_REF, SERVICE_ID, 'baseline')).toBe(false);
	});

	test('a restricted-built Deployment matches when reconciled under restricted', () => {
		const cfg = config();
		const built = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF, { podSecurityEnforce: 'restricted' });
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID, 'restricted')).toBe(true);
	});

	// Guard the capability matcher in the FAILING direction (the privilege-escalation check would otherwise mask it).
	test('under restricted, a Deployment with wrong dropped capabilities is a mismatch', () => {
		const cfg = config();
		const built = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF, { podSecurityEnforce: 'restricted' });
		built.spec!.template!.spec!.containers[0]!.securityContext!.capabilities!.drop = ['NET_RAW'];
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID, 'restricted')).toBe(false);
	});
});

describe('buildDeployment runtimeClass', () => {
	test('sets runtimeClassName when provided', () => {
		expect(podSpec({ runtimeClass: 'gvisor' }).runtimeClassName).toBe('gvisor');
	});

	test('omits runtimeClassName when absent (plain runc)', () => {
		expect(podSpec().runtimeClassName).toBeUndefined();
	});

	test('a runtimeClass change is a mismatch, so it rolls once', () => {
		const cfg = config();
		const built = buildDeployment(deployment, NAMESPACE, cfg, IMAGE_REF, { runtimeClass: 'gvisor' });
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID, undefined, 'gvisor')).toBe(true);
		expect(deploymentMatchesConfig(built, cfg, IMAGE_REF, SERVICE_ID, undefined, '')).toBe(false);
	});
});
