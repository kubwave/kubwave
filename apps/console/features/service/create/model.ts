import type { CreateFromTemplateDto, CreateServiceDto, TemplateDto } from '@kubwave/api-client';
import * as z from 'zod';
import { errorCode, serviceErrorMessage } from '@/lib/api/api-error';
import { isPrivateRepoSshUrl, privateRepoSshUrlMessage } from '@/lib/private-repo-url';
import { watchPathConfigFields } from '@/lib/repo-watch-paths';
import { DATABASE_ENGINE_UI, type DatabaseEngine } from '@/lib/service-types';

export type RepoSource = 'public-repo' | 'private-repo' | 'github-repo' | 'gitea-repo';

// Split "registry/image:tag"; the tag colon must come after the last slash so a registry port isn't mistaken for a tag.
// Digest refs (image@sha256:…) are not supported: services pin a tag.
export function parseImageRef(value: string): { image: string; tag: string } | null {
	const ref = value.trim();
	if (ref.includes('@')) return null;
	const lastSlash = ref.lastIndexOf('/');
	const lastColon = ref.lastIndexOf(':');
	if (!ref || lastColon <= lastSlash || lastColon === ref.length - 1) return null;
	const image = ref.slice(0, lastColon).trim();
	const tag = ref.slice(lastColon + 1).trim();
	return image && tag ? { image, tag } : null;
}

const slug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 50);

export function uniqueName(base: string, taken: readonly string[]): string {
	const root = base || 'service';
	let name = root;
	for (let i = 2; taken.includes(name); i++) name = `${root}-${i}`;
	return name;
}

export function imageBaseName(ref: string): string {
	const withoutDigest = ref.trim().split('@')[0] ?? '';
	const colon = withoutDigest.lastIndexOf(':');
	const image = colon > withoutDigest.lastIndexOf('/') ? withoutDigest.slice(0, colon) : withoutDigest;
	return slug(image.slice(image.lastIndexOf('/') + 1));
}

// Works for http(s), scp-style (git@host:org/repo), ssh:// URLs and "owner/repo".
export function repoBaseName(source: string): string {
	const path = source
		.trim()
		.replace(/\/+$/, '')
		.replace(/\.git$/, '');
	return slug(path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf(':')) + 1));
}

// Matches the API's dockerfileConfigSchema.
export const hasFromInstruction = (dockerfile: string) => dockerfile.split('\n').some(line => /^\s*FROM\s+\S+/i.test(line));

export function parsePort(value: string): number | null {
	const port = Number(value.trim());
	return value.trim() && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

const nameField = (taken: readonly string[], required: boolean) =>
	z
		.string()
		.trim()
		.max(100, 'Use at most 100 characters.')
		.refine(name => !required || name.length > 0, 'Enter a service name.')
		.refine(name => !taken.includes(name), 'A service with that name already exists.');

const commitField = z
	.string()
	.trim()
	.regex(/^[0-9a-fA-F]{7,64}$/, 'Enter a valid commit SHA.')
	.or(z.literal(''));

const emptyRuntime = { env: [], domains: [], volumes: [] };

export const imageDefaults = {
	name: '',
	imageRef: '',
	containerPort: '',
	description: '',
	registryEnabled: false,
	registryServer: '',
	registryUsername: '',
	registryPassword: '',
	watchEnabled: false
};
export type ImageValues = typeof imageDefaults;

export const imageSchema = (taken: readonly string[]) =>
	z
		.object({
			name: nameField(taken, false),
			imageRef: z
				.string()
				.trim()
				.min(1, 'Enter an image.')
				.refine(value => parseImageRef(value) !== null, 'Use the form registry/image:tag.'),
			containerPort: z.string().refine(value => !value.trim() || parsePort(value) !== null, 'Enter a port from 1 to 65535.'),
			description: z.string(),
			registryEnabled: z.boolean(),
			registryServer: z.string(),
			registryUsername: z.string(),
			registryPassword: z.string(),
			watchEnabled: z.boolean()
		})
		.superRefine((values, ctx) => {
			if (!values.registryEnabled) return;
			if (!values.registryServer.trim()) ctx.addIssue({ code: 'custom', message: 'Enter a registry host, e.g. ghcr.io.', path: ['registryServer'] });
			if (!values.registryUsername.trim()) ctx.addIssue({ code: 'custom', message: 'Enter a username or token.', path: ['registryUsername'] });
			if (!values.registryPassword) ctx.addIssue({ code: 'custom', message: 'Enter a password or token.', path: ['registryPassword'] });
		});

export const imageNameSuggestion = (imageRef: string, taken: readonly string[]) =>
	imageRef.trim() ? uniqueName(imageBaseName(imageRef), taken) : '';

export function imagePayload(values: ImageValues, taken: readonly string[]): CreateServiceDto {
	const { image, tag } = parseImageRef(values.imageRef) ?? { image: values.imageRef.trim(), tag: '' };
	return {
		name: values.name.trim() || imageNameSuggestion(values.imageRef, taken),
		description: values.description.trim(),
		type: 'docker-image',
		config: {
			image,
			tag,
			containerPort: parsePort(values.containerPort),
			...emptyRuntime,
			...(values.registryEnabled
				? {
						registryAuth: {
							enabled: true,
							server: values.registryServer.trim(),
							username: values.registryUsername.trim(),
							password: values.registryPassword
						}
					}
				: {})
		},
		imageWatch: { enabled: values.watchEnabled }
	};
}

export const dockerfileDefaults = { name: '', dockerfile: '', description: '' };
export type DockerfileValues = typeof dockerfileDefaults;

export const dockerfileSchema = (taken: readonly string[]) =>
	z.object({
		name: nameField(taken, true),
		dockerfile: z.string().trim().min(1, 'Paste a Dockerfile.').refine(hasFromInstruction, 'A Dockerfile must contain a FROM instruction.'),
		description: z.string()
	});

export const dockerfilePayload = (values: DockerfileValues): CreateServiceDto => ({
	name: values.name.trim(),
	description: values.description.trim(),
	type: 'dockerfile',
	config: { dockerfile: values.dockerfile, containerPort: null, ...emptyRuntime }
});

export const databaseDefaults = (engine: DatabaseEngine, taken: readonly string[]) => ({
	name: uniqueName(engine, taken),
	version: DATABASE_ENGINE_UI[engine].defaultVersion,
	database: '',
	username: '',
	storage: '1Gi',
	description: ''
});
export type DatabaseValues = ReturnType<typeof databaseDefaults>;

const identifierField = z
	.string()
	.trim()
	.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, digits, and underscores; start with a letter.')
	.or(z.literal(''));

export const databaseSchema = (taken: readonly string[]) =>
	z.object({
		name: nameField(taken, true),
		version: z.string().min(1, 'Pick a version.'),
		database: identifierField,
		username: identifierField,
		storage: z
			.string()
			.trim()
			.regex(/^\d+(\.\d+)?[EPTGMK]i?$/, 'Enter a quantity like 1Gi.')
			.or(z.literal('')),
		description: z.string()
	});

export function databasePayload(engine: DatabaseEngine, values: DatabaseValues): CreateServiceDto {
	const database = values.database.trim();
	const username = values.username.trim();
	return {
		name: values.name.trim(),
		description: values.description.trim(),
		type: engine,
		config: {
			version: values.version,
			storage: { size: values.storage.trim() || '1Gi' },
			...(database ? { database } : {}),
			...(username ? { username } : {})
		}
	};
}

export const repoDefaults = {
	name: '',
	repoUrl: '',
	sshKeyId: '',
	installationId: '',
	repoFullName: '',
	branch: 'main',
	builder: 'nixpacks' as 'nixpacks' | 'dockerfile',
	dockerfilePath: '',
	commit: '',
	rootDirectory: '',
	buildCommand: '',
	startCommand: '',
	autoDeploy: false,
	watchEntireRepo: false,
	watchPaths: '',
	description: ''
};
export type RepoValues = typeof repoDefaults;

export const REPO_PROVIDER_LABEL = { 'github-repo': 'GitHub', 'gitea-repo': 'Gitea' } as const;

export const repoSchema = (source: RepoSource, taken: readonly string[]) =>
	z
		.object({
			name: nameField(taken, false),
			repoUrl: z.string(),
			sshKeyId: z.string(),
			installationId: z.string(),
			repoFullName: z.string(),
			branch: z.string().trim().min(1, 'Enter a branch.'),
			builder: z.enum(['nixpacks', 'dockerfile']),
			dockerfilePath: z.string(),
			commit: commitField,
			rootDirectory: z.string(),
			buildCommand: z.string(),
			startCommand: z.string(),
			autoDeploy: z.boolean(),
			watchEntireRepo: z.boolean(),
			watchPaths: z.string(),
			description: z.string()
		})
		.superRefine((values, ctx) => {
			const issue = (path: keyof RepoValues, message: string) => ctx.addIssue({ code: 'custom', message, path: [path] });
			const url = values.repoUrl.trim();
			if (source === 'public-repo') {
				if (!url) issue('repoUrl', 'Enter a repository URL.');
				else if (!/^https?:\/\/\S+$/i.test(url)) issue('repoUrl', 'Enter a public http(s) Git URL.');
			} else if (source === 'private-repo') {
				if (!url) issue('repoUrl', 'Enter a repository URL.');
				else if (!isPrivateRepoSshUrl(url)) issue('repoUrl', privateRepoSshUrlMessage);
				if (!values.sshKeyId) issue('sshKeyId', 'Select a deploy key.');
			} else {
				if (!values.installationId) issue('installationId', `Select a ${REPO_PROVIDER_LABEL[source]} account.`);
				if (!values.repoFullName) issue('repoFullName', 'Select a repository.');
			}
		});

export function repoNameSuggestion(source: RepoSource, values: Pick<RepoValues, 'repoUrl' | 'repoFullName'>, taken: readonly string[]): string {
	const origin = source === 'github-repo' || source === 'gitea-repo' ? values.repoFullName : values.repoUrl;
	return origin.trim() ? uniqueName(repoBaseName(origin), taken) : '';
}

export function repoPayload(source: RepoSource, values: RepoValues, taken: readonly string[]): CreateServiceDto {
	const optional = (key: string, value: string, when = true) => (when && value.trim() ? { [key]: value.trim() } : {});
	const nixpacks = values.builder === 'nixpacks';
	const origin =
		source === 'github-repo' || source === 'gitea-repo'
			? { installationId: values.installationId, repoFullName: values.repoFullName }
			: { repoUrl: values.repoUrl.trim(), ...(source === 'private-repo' ? { sshKeyId: values.sshKeyId } : {}) };
	return {
		name: values.name.trim() || repoNameSuggestion(source, values, taken),
		description: values.description.trim(),
		type: source,
		config: {
			...origin,
			branch: values.branch.trim(),
			builder: values.builder,
			...optional('dockerfilePath', values.dockerfilePath, !nixpacks),
			...optional('commit', values.commit),
			...optional('rootDirectory', values.rootDirectory),
			...watchPathConfigFields(values.watchPaths, values.watchEntireRepo),
			...optional('buildCommand', values.buildCommand, nixpacks),
			...optional('startCommand', values.startCommand, nixpacks),
			containerPort: null,
			...emptyRuntime
		},
		autoDeploy: { enabled: values.autoDeploy }
	};
}

export function privateRepoErrorMessage(err: unknown): string {
	const code = errorCode(err);
	if (code === 'ssh_key_not_found' || code === 'validation_error')
		return 'Check the repository URL and that the selected deploy key belongs to this team.';
	return serviceErrorMessage(err, 'Could not create service.');
}

export const composeSchema = z.object({
	compose: z.string().trim().min(1, 'Paste a Docker Compose file.').max(200_000, 'Compose file is too large.')
});

export function composeErrorMessage(err: unknown): string {
	const body = err && typeof err === 'object' ? (err as { error?: unknown; details?: { message?: unknown } }) : {};
	if (typeof body.details?.message === 'string') return body.details.message;
	if (body.error === 'service_name_taken') return 'One or more services already exist in this environment.';
	if (body.error === 'compose_import_failed' || body.error === 'validation_error') return 'Could not import this Compose file.';
	return 'Could not import services.';
}

type TemplateInputs = Pick<TemplateDto, 'id' | 'inputs'>;
export type TemplateValues = { name: string; inputs: Record<string, string> };

export const templateDefaults = (template: TemplateInputs, taken: readonly string[]): TemplateValues => ({
	name: uniqueName(template.id, taken),
	inputs: Object.fromEntries(template.inputs.map(input => [input.key, input.default ?? '']))
});

export const templateSchema = (template: TemplateInputs, taken: readonly string[]) =>
	z.object({
		name: nameField(taken, true),
		inputs: z.object(
			Object.fromEntries(
				template.inputs.map(input => [input.key, input.required ? z.string().trim().min(1, `${input.label} is required.`) : z.string()])
			)
		)
	});

export const templatePayload = (template: TemplateInputs, values: TemplateValues): CreateFromTemplateDto => ({
	templateId: template.id,
	name: values.name.trim(),
	inputs: Object.fromEntries(template.inputs.map(input => [input.key, (values.inputs[input.key] ?? '').trim()]))
});

export function templateErrorMessage(err: unknown): string {
	if (errorCode(err) === 'template_input_required') return 'Please fill in all required fields.';
	return serviceErrorMessage(err, 'Could not create from template.');
}
