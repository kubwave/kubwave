import { describe, expect, test } from 'bun:test';
import type { TemplateDto } from '@kubwave/api-client';
import {
	composeErrorMessage,
	databaseDefaults,
	databasePayload,
	databaseSchema,
	dockerfilePayload,
	dockerfileSchema,
	hasFromInstruction,
	imageBaseName,
	imageDefaults,
	imagePayload,
	imageSchema,
	parseImageRef,
	privateRepoErrorMessage,
	repoBaseName,
	repoDefaults,
	repoPayload,
	repoSchema,
	templateDefaults,
	templateErrorMessage,
	templatePayload,
	templateSchema,
	uniqueName
} from '../features/service/create/model';

const issues = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
	Object.fromEntries((result.error?.issues ?? []).map(issue => [issue.path.join('.'), issue.message]));

describe('parseImageRef', () => {
	test('splits image and tag', () => {
		expect(parseImageRef(' nginx:alpine ')).toEqual({ image: 'nginx', tag: 'alpine' });
		expect(parseImageRef('ghcr.io/acme/web:1.2')).toEqual({ image: 'ghcr.io/acme/web', tag: '1.2' });
	});

	test('does not mistake a registry port for a tag', () => {
		expect(parseImageRef('registry:5000/web')).toBeNull();
		expect(parseImageRef('registry:5000/web:v1')).toEqual({ image: 'registry:5000/web', tag: 'v1' });
	});

	test('rejects a missing or empty tag', () => {
		expect(parseImageRef('nginx')).toBeNull();
		expect(parseImageRef('nginx@sha256:0123abcd')).toBeNull();
		expect(parseImageRef('nginx:')).toBeNull();
		expect(parseImageRef('')).toBeNull();
	});
});

describe('names', () => {
	test('uniqueName suffixes taken names', () => {
		expect(uniqueName('web', [])).toBe('web');
		expect(uniqueName('web', ['web', 'web-2'])).toBe('web-3');
		expect(uniqueName('', [])).toBe('service');
	});

	test('imageBaseName uses the last path segment without tag or digest', () => {
		expect(imageBaseName('ghcr.io/acme/Web_App:latest')).toBe('web-app');
		expect(imageBaseName('nginx:alpine')).toBe('nginx');
		expect(imageBaseName('registry:5000/api@sha256:abc')).toBe('api');
	});

	test('repoBaseName handles http, scp-style, ssh:// and owner/repo', () => {
		expect(repoBaseName('https://github.com/acme/shop.git')).toBe('shop');
		expect(repoBaseName('git@github.com:acme/api.git')).toBe('api');
		expect(repoBaseName('ssh://git@host:2222/acme/jobs/')).toBe('jobs');
		expect(repoBaseName('acme/Storefront')).toBe('storefront');
	});
});

describe('hasFromInstruction', () => {
	test('needs a FROM line', () => {
		expect(hasFromInstruction('# base\n  from nginx:alpine\nRUN true')).toBe(true);
		expect(hasFromInstruction('RUN echo FROM')).toBe(false);
	});
});

describe('docker image', () => {
	test('validates image ref, port, registry credentials and name collisions', () => {
		const result = imageSchema(['web']).safeParse({
			...imageDefaults,
			name: 'web',
			imageRef: 'nginx',
			containerPort: '70000',
			registryEnabled: true
		});
		expect(issues(result)).toEqual({
			name: 'A service with that name already exists.',
			imageRef: 'Use the form registry/image:tag.',
			containerPort: 'Enter a port from 1 to 65535.',
			registryServer: 'Enter a registry host, e.g. ghcr.io.',
			registryUsername: 'Enter a username or token.',
			registryPassword: 'Enter a password or token.'
		});
	});

	test('builds the create payload, deriving the name from the image', () => {
		expect(imagePayload({ ...imageDefaults, imageRef: 'nginx:alpine', containerPort: '80', watchEnabled: true }, ['nginx'])).toEqual({
			name: 'nginx-2',
			description: '',
			type: 'docker-image',
			config: { image: 'nginx', tag: 'alpine', containerPort: 80, env: [], domains: [], volumes: [] },
			imageWatch: { enabled: true }
		});
	});

	test('includes registry auth only when enabled', () => {
		const payload = imagePayload(
			{
				...imageDefaults,
				name: ' web ',
				imageRef: 'ghcr.io/acme/web:1',
				registryEnabled: true,
				registryServer: ' ghcr.io ',
				registryUsername: ' bot ',
				registryPassword: 'p w'
			},
			[]
		);
		expect(payload.name).toBe('web');
		expect(payload.config).toMatchObject({
			containerPort: null,
			registryAuth: { enabled: true, server: 'ghcr.io', username: 'bot', password: 'p w' }
		});
	});
});

describe('dockerfile', () => {
	test('requires a name and a FROM instruction', () => {
		expect(issues(dockerfileSchema([]).safeParse({ name: ' ', dockerfile: 'RUN true', description: '' }))).toEqual({
			name: 'Enter a service name.',
			dockerfile: 'A Dockerfile must contain a FROM instruction.'
		});
	});

	test('builds the payload', () => {
		expect(dockerfilePayload({ name: 'site ', dockerfile: 'FROM nginx', description: 'x' })).toEqual({
			name: 'site',
			description: 'x',
			type: 'dockerfile',
			config: { dockerfile: 'FROM nginx', containerPort: null, env: [], domains: [], volumes: [] }
		});
	});
});

describe('database', () => {
	test('defaults to a free engine name and the engine default version', () => {
		expect(databaseDefaults('postgres', ['postgres'])).toEqual({
			name: 'postgres-2',
			version: '16',
			database: '',
			username: '',
			storage: '1Gi',
			description: ''
		});
	});

	test('validates identifiers and storage quantity', () => {
		const result = databaseSchema([]).safeParse({ ...databaseDefaults('mysql', []), database: '1db', username: 'ok_user', storage: '1GB' });
		expect(issues(result)).toEqual({
			database: 'Use letters, digits, and underscores; start with a letter.',
			storage: 'Enter a quantity like 1Gi.'
		});
	});

	test('omits blank optional fields and defaults storage', () => {
		expect(databasePayload('postgres', { ...databaseDefaults('postgres', []), storage: ' ', username: ' admin ' })).toEqual({
			name: 'postgres',
			description: '',
			type: 'postgres',
			config: { version: '16', storage: { size: '1Gi' }, username: 'admin' }
		});
	});
});

describe('repositories', () => {
	test('public repos need an http(s) URL and a branch', () => {
		const result = repoSchema('public-repo', []).safeParse({ ...repoDefaults, repoUrl: 'git@github.com:a/b.git', branch: ' ', commit: 'xyz' });
		expect(issues(result)).toEqual({ repoUrl: 'Enter a public http(s) Git URL.', branch: 'Enter a branch.', commit: 'Enter a valid commit SHA.' });
	});

	test('private repos need an SSH URL and a deploy key', () => {
		const result = repoSchema('private-repo', []).safeParse({ ...repoDefaults, repoUrl: 'https://github.com/a/b' });
		expect(Object.keys(issues(result)).sort()).toEqual(['repoUrl', 'sshKeyId']);
		expect(repoSchema('private-repo', []).safeParse({ ...repoDefaults, repoUrl: 'git@github.com:a/b.git', sshKeyId: 'k' }).success).toBe(true);
	});

	test('GitHub and Gitea repos need an account and a repository', () => {
		expect(issues(repoSchema('github-repo', []).safeParse(repoDefaults))).toEqual({
			installationId: 'Select a GitHub account.',
			repoFullName: 'Select a repository.'
		});
		expect(issues(repoSchema('gitea-repo', []).safeParse(repoDefaults)).installationId).toBe('Select a Gitea account.');
	});

	test('builds a nixpacks payload with watch paths and auto-deploy', () => {
		expect(
			repoPayload(
				'public-repo',
				{
					...repoDefaults,
					repoUrl: ' https://github.com/acme/shop ',
					branch: ' dev ',
					commit: ' abcdef1 ',
					rootDirectory: 'apps/web',
					buildCommand: 'bun run build',
					dockerfilePath: 'ignored',
					autoDeploy: true,
					watchPaths: '/packages/ui/\n\n'
				},
				[]
			)
		).toEqual({
			name: 'shop',
			description: '',
			type: 'public-repo',
			config: {
				repoUrl: 'https://github.com/acme/shop',
				branch: 'dev',
				builder: 'nixpacks',
				commit: 'abcdef1',
				rootDirectory: 'apps/web',
				watchPaths: ['packages/ui'],
				buildCommand: 'bun run build',
				containerPort: null,
				env: [],
				domains: [],
				volumes: []
			},
			autoDeploy: { enabled: true }
		});
	});

	test('dockerfile builds keep the path and drop nixpacks commands; git sources send the installation', () => {
		const payload = repoPayload(
			'gitea-repo',
			{
				...repoDefaults,
				name: 'api',
				installationId: 'inst',
				repoFullName: 'acme/api',
				repoUrl: 'ignored',
				builder: 'dockerfile',
				dockerfilePath: 'docker/Dockerfile',
				startCommand: 'ignored',
				watchEntireRepo: true
			},
			[]
		);
		expect(payload.config).toEqual({
			installationId: 'inst',
			repoFullName: 'acme/api',
			branch: 'main',
			builder: 'dockerfile',
			dockerfilePath: 'docker/Dockerfile',
			watchEntireRepo: true,
			containerPort: null,
			env: [],
			domains: [],
			volumes: []
		});
	});

	test('private repos send the deploy key', () => {
		const payload = repoPayload('private-repo', { ...repoDefaults, repoUrl: 'git@host:a/jobs.git', sshKeyId: 'key-1' }, ['jobs']);
		expect(payload.name).toBe('jobs-2');
		expect(payload.config).toMatchObject({ repoUrl: 'git@host:a/jobs.git', sshKeyId: 'key-1' });
	});

	test('explains deploy-key failures', () => {
		expect(privateRepoErrorMessage({ error: 'ssh_key_not_found' })).toBe(
			'Check the repository URL and that the selected deploy key belongs to this team.'
		);
		expect(privateRepoErrorMessage({ error: 'service_name_taken' })).toBe('A service with that name already exists.');
	});
});

describe('compose', () => {
	test('maps import errors', () => {
		expect(composeErrorMessage({ error: 'compose_import_failed', details: { message: 'services.web: image missing' } })).toBe(
			'services.web: image missing'
		);
		expect(composeErrorMessage({ error: 'service_name_taken' })).toBe('One or more services already exist in this environment.');
		expect(composeErrorMessage({ error: 'validation_error' })).toBe('Could not import this Compose file.');
		expect(composeErrorMessage(new Error('x'))).toBe('Could not import services.');
	});
});

describe('templates', () => {
	const template = {
		id: 'plausible',
		name: 'Plausible',
		inputs: [
			{ key: 'DOMAIN', label: 'Domain', type: 'string', required: true },
			{ key: 'ADMIN_EMAIL', label: 'Admin email', type: 'string', required: false, default: 'me@example.com' }
		]
	} as unknown as TemplateDto;

	test('prefills a free name and input defaults', () => {
		expect(templateDefaults(template, ['plausible'])).toEqual({ name: 'plausible-2', inputs: { DOMAIN: '', ADMIN_EMAIL: 'me@example.com' } });
	});

	test('requires required inputs', () => {
		expect(issues(templateSchema(template, []).safeParse({ name: 'x', inputs: { DOMAIN: ' ', ADMIN_EMAIL: '' } }))).toEqual({
			'inputs.DOMAIN': 'Domain is required.'
		});
	});

	test('builds the request with trimmed values', () => {
		expect(templatePayload(template, { name: ' stats ', inputs: { DOMAIN: ' a.io ' } })).toEqual({
			templateId: 'plausible',
			name: 'stats',
			inputs: { DOMAIN: 'a.io', ADMIN_EMAIL: '' }
		});
	});

	test('maps missing input errors', () => {
		expect(templateErrorMessage({ error: 'template_input_required' })).toBe('Please fill in all required fields.');
		expect(templateErrorMessage({ error: 'boom' })).toBe('Could not create from template.');
	});
});
