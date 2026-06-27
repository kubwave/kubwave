import { describe, expect, it } from 'bun:test';
import type { Service } from '@kubwave/db';
import { deployablePreviewRows, planPreviewServices } from '~/modules/worker/jobs/pr-preview/clone-plan';

function baseService(over: Partial<Service> & { id: string; type: Service['type']; config: Service['config'] }): Service {
	return {
		description: '',
		name: 'svc',
		environmentId: 'BASE',
		autoDeployEnabled: false,
		lastPolledCommit: null,
		lastPolledAt: null,
		nextPollAt: null,
		lastPollError: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...over
	} as Service;
}

const ctx = {
	previewEnvironmentId: 'PREVIEW',
	baseNamespace: 'kubwave-env-BASE',
	previewNamespace: 'kubwave-env-PREVIEW',
	prRepoUrl: 'git@gitea.example:org/app.git',
	prRef: 'refs/pull/42/head',
	headSha: 'f'.repeat(40),
	newId: (() => {
		let n = 0;
		return () => `id-${++n}`;
	})()
};

function defaultDomainHost(service: { serviceId: string; serviceName: string }): string {
	return `${service.serviceName}-${service.serviceId.replace(/-/g, '').slice(0, 8)}.kubwave.com`;
}

describe('planPreviewServices', () => {
	it('puts the PR-repo service on the PR ref with auto-deploy on, pinned to head', () => {
		const base = [
			baseService({
				id: 'svc-front',
				type: 'private-repo',
				name: 'frontend',
				config: {
					repoUrl: ctx.prRepoUrl,
					branch: 'main',
					sshKeyId: 'k',
					builder: 'nixpacks',
					containerPort: 3000,
					env: [],
					domains: [],
					volumes: []
				} as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		expect(services).toHaveLength(1);
		const s = services[0]!;
		expect(s.environmentId).toBe('PREVIEW');
		expect(s.autoDeployEnabled).toBe(true);
		const cfg = s.config as { branch: string; commit?: string };
		expect(cfg.branch).toBe('refs/pull/42/head');
		expect(cfg.commit).toBe('f'.repeat(40));
		expect(s.lastPolledCommit).toBe('f'.repeat(40));
	});

	it('freezes a different-repo service: pins its current commit, auto-deploy off, custom domains dropped', () => {
		const base = [
			baseService({
				id: 'svc-api',
				type: 'public-repo',
				name: 'api',
				autoDeployEnabled: true,
				lastPolledCommit: 'a'.repeat(40),
				config: {
					repoUrl: 'https://github.com/org/other',
					branch: 'main',
					builder: 'nixpacks',
					containerPort: 8080,
					env: [],
					domains: [{ host: 'api.example.com', port: 8080 }],
					volumes: []
				} as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		const s = services[0]!;
		expect(s.autoDeployEnabled).toBe(false);
		const cfg = s.config as { commit?: string; domains: unknown[] };
		expect(cfg.commit).toBe('a'.repeat(40));
		expect(cfg.domains).toEqual([]);
		expect(s.lastPolledCommit).toBeNull();
	});

	it('rewrites cross-refs in plaintext env using the base→preview svc-id map', () => {
		const base = [
			baseService({
				id: 'svc-db',
				type: 'docker-image',
				name: 'db',
				config: { image: 'postgres', tag: '16', containerPort: 5432, env: [], domains: [], volumes: [] } as never
			}),
			baseService({
				id: 'svc-app',
				type: 'docker-image',
				name: 'app',
				config: {
					image: 'app',
					tag: 'latest',
					containerPort: 3000,
					domains: [],
					volumes: [],
					env: [{ key: 'DATABASE_URL', value: 'postgres://svc-svc-db.kubwave-env-BASE.svc.cluster.local:5432/db' }]
				} as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		const app = services.find(s => s.name === 'app')!;
		const db = services.find(s => s.name === 'db')!;
		const url = (app.config as { env: { key: string; value: string }[] }).env[0]!.value;
		expect(url).toContain(`svc-${db.id}`);
		expect(url).toContain('kubwave-env-PREVIEW');
		expect(url).not.toContain('kubwave-env-BASE');
	});

	it('rewrites generated default-domain hosts in plaintext env using the base→preview service ids', () => {
		const previewId = '3448ea31-476b-4a8a-a548-eb64a8250e2d';
		const base = [
			baseService({
				id: '0820689f-0000-0000-0000-000000000000',
				type: 'dockerfile',
				name: 'docs',
				config: {
					dockerfile: 'FROM nginx',
					containerPort: 3000,
					defaultDomainEnabled: true,
					env: [{ key: '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', value: 'docs-0820689f.kubwave.com' }],
					domains: [],
					volumes: []
				} as never
			})
		];

		const { services } = planPreviewServices(base, { ...ctx, defaultDomainHost, newId: () => previewId });
		const env = (services[0]!.config as { env: { key: string; value: string }[] }).env;
		expect(env).toEqual([{ key: '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', value: 'docs-3448ea31.kubwave.com' }]);
	});

	it('does not rewrite default-domain hosts when the base domain is inactive or unresolved', () => {
		const ids = [
			'aaaaaaaa-0000-0000-0000-000000000000',
			'bbbbbbbb-0000-0000-0000-000000000000',
			'cccccccc-0000-0000-0000-000000000000',
			'dddddddd-0000-0000-0000-000000000000'
		];
		let next = 0;
		const base = [
			baseService({
				id: '11111111-0000-0000-0000-000000000000',
				type: 'docker-image',
				name: 'disabled',
				config: {
					image: 'app',
					tag: '1',
					containerPort: 3000,
					defaultDomainEnabled: false,
					env: [{ key: 'HOST', value: 'disabled-11111111.kubwave.com' }],
					domains: [],
					volumes: []
				} as never
			}),
			baseService({
				id: '22222222-0000-0000-0000-000000000000',
				type: 'docker-image',
				name: 'no-port',
				config: {
					image: 'app',
					tag: '1',
					containerPort: null,
					defaultDomainEnabled: true,
					env: [{ key: 'HOST', value: 'no-port-22222222.kubwave.com' }],
					domains: [],
					volumes: []
				} as never
			}),
			baseService({
				id: '33333333-0000-0000-0000-000000000000',
				type: 'docker-image',
				name: 'custom',
				config: {
					image: 'app',
					tag: '1',
					containerPort: 3000,
					defaultDomainEnabled: true,
					env: [{ key: 'HOST', value: 'custom-33333333.kubwave.com' }],
					domains: [{ host: 'custom.example.com', port: 3000 }],
					volumes: []
				} as never
			}),
			baseService({
				id: '44444444-0000-0000-0000-000000000000',
				type: 'docker-image',
				name: 'unresolved',
				config: {
					image: 'app',
					tag: '1',
					containerPort: 3000,
					defaultDomainEnabled: true,
					env: [{ key: 'HOST', value: 'unresolved-44444444.kubwave.com' }],
					domains: [],
					volumes: []
				} as never
			})
		];

		const { services } = planPreviewServices(base, {
			...ctx,
			defaultDomainHost: service => (service.serviceName === 'unresolved' ? null : defaultDomainHost(service)),
			newId: () => ids[next++]!
		});
		const valueByName = new Map(services.map(s => [s.name, (s.config as { env: { value: string }[] }).env[0]!.value]));

		expect(valueByName.get('disabled')).toBe('disabled-11111111.kubwave.com');
		expect(valueByName.get('no-port')).toBe('no-port-22222222.kubwave.com');
		expect(valueByName.get('custom')).toBe('custom-33333333.kubwave.com');
		expect(valueByName.get('unresolved')).toBe('unresolved-44444444.kubwave.com');
	});

	it('tracks every service sharing the PR repoUrl (monorepo)', () => {
		const base = [
			baseService({
				id: 'svc-api',
				type: 'private-repo',
				name: 'api',
				config: {
					repoUrl: ctx.prRepoUrl,
					branch: 'main',
					sshKeyId: 'k',
					builder: 'nixpacks',
					containerPort: 8080,
					env: [],
					domains: [],
					volumes: []
				} as never
			}),
			baseService({
				id: 'svc-worker',
				type: 'private-repo',
				name: 'worker',
				config: {
					repoUrl: ctx.prRepoUrl,
					branch: 'main',
					sshKeyId: 'k',
					builder: 'nixpacks',
					containerPort: 0,
					env: [],
					domains: [],
					volumes: []
				} as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		expect(services.filter(s => s.autoDeployEnabled)).toHaveLength(2);
		for (const s of services) expect((s.config as { branch: string }).branch).toBe('refs/pull/42/head');
	});
});

describe('deployablePreviewRows', () => {
	it('deploys PR-tracking + succeeded-in-base services; skips never-deployed ones', () => {
		const base = [
			baseService({
				id: 'svc-pr',
				type: 'private-repo',
				name: 'pr',
				config: {
					repoUrl: ctx.prRepoUrl,
					branch: 'main',
					sshKeyId: 'k',
					builder: 'nixpacks',
					containerPort: 3000,
					env: [],
					domains: [],
					volumes: []
				} as never
			}),
			baseService({
				id: 'svc-run',
				type: 'docker-image',
				name: 'run',
				config: { image: 'a', tag: '1', containerPort: 80, env: [], domains: [], volumes: [] } as never
			}),
			baseService({
				id: 'svc-idle',
				type: 'docker-image',
				name: 'idle',
				config: { image: 'b', tag: '1', containerPort: 80, env: [], domains: [], volumes: [] } as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		// svc-run is running in prod (succeeded deployment); svc-idle was never deployed. svc-pr is
		// NOT in `deployed` — it must still be included purely via tracksPr.
		const deployed = new Set(['svc-run']);
		const rows = deployablePreviewRows(base, services, deployed, ctx.prRepoUrl);
		const names = rows.map(r => r.name).sort();
		expect(names).toEqual(['pr', 'run']); // svc-idle excluded; svc-pr included via tracksPr despite not in `deployed`
	});

	it('includes a non-PR service whose base id is in deployedBaseIds', () => {
		const base = [
			baseService({
				id: 'svc-run',
				type: 'docker-image',
				name: 'run',
				config: { image: 'a', tag: '1', containerPort: 80, env: [], domains: [], volumes: [] } as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		const rows = deployablePreviewRows(base, services, new Set(['svc-run']), ctx.prRepoUrl);
		expect(rows.map(r => r.name)).toEqual(['run']);
	});

	it('excludes a non-PR service whose base id is NOT in deployedBaseIds', () => {
		const base = [
			baseService({
				id: 'svc-idle',
				type: 'docker-image',
				name: 'idle',
				config: { image: 'b', tag: '1', containerPort: 80, env: [], domains: [], volumes: [] } as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		const rows = deployablePreviewRows(base, services, new Set<string>(), ctx.prRepoUrl);
		expect(rows).toHaveLength(0);
	});

	it('aligns base[i] ↔ rows[i]: a deployed base id only keeps its own row, not a same-index sibling', () => {
		const base = [
			baseService({
				id: 'svc-a',
				type: 'docker-image',
				name: 'a',
				config: { image: 'a', tag: '1', containerPort: 80, env: [], domains: [], volumes: [] } as never
			}),
			baseService({
				id: 'svc-b',
				type: 'docker-image',
				name: 'b',
				config: { image: 'b', tag: '1', containerPort: 80, env: [], domains: [], volumes: [] } as never
			})
		];
		const { services } = planPreviewServices(base, ctx);
		// Only svc-b (index 1) is deployed; its row must be the one kept, proving index alignment.
		const rows = deployablePreviewRows(base, services, new Set(['svc-b']), ctx.prRepoUrl);
		expect(rows.map(r => r.name)).toEqual(['b']);
	});
});
