import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1;

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Use letters, digits, underscores; start with a letter.');
const slug = z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use kebab-case (lowercase, digits, dashes).');

// Clean relative volume subPath; mirrors the backend serviceVolumeSchema so a template can't smuggle a path the API would reject.
const cleanRelativeSubPath = z
	.string()
	.trim()
	.min(1)
	.max(512)
	.regex(/^[^/]/, 'subPath must be a relative path without a leading slash.')
	.refine(
		v => v.split('/').every(seg => seg.trim().length > 0 && seg !== '.' && seg !== '..'),
		'subPath must not contain empty, "." or ".." segments.'
	);

export const templateInputSchema = z.object({
	key: identifier,
	label: z.string().min(1),
	type: z.literal('string').default('string'),
	required: z.boolean().default(false),
	default: z.string().optional(),
	placeholder: z.string().optional()
});

const passwordSecretSchema = z.object({
	key: identifier,
	generate: z.literal('password')
});
// A JWT minted at instantiation, HS256-signed with another (earlier) secret's value; used for Supabase anon/service keys.
const jwtSecretSchema = z.object({
	key: identifier,
	generate: z.literal('jwt'),
	signWith: identifier,
	claims: z.record(z.string(), z.string()),
	expiresInDays: z.number().int().positive().default(3650)
});
export const templateSecretSchema = z.discriminatedUnion('generate', [passwordSecretSchema, jwtSecretSchema]);

// Placeholders ({{ ... }}) allowed in string fields; resolution + strict validation happen later (build-time reference check, runtime createService zod).
const templateServiceConfigSchema = z.object({
	image: z.string().min(1),
	tag: z.string().min(1),
	containerPort: z.number().int().min(1).max(65535).nullable().default(null),
	defaultDomainEnabled: z.boolean().optional(),
	env: z.array(z.object({ key: z.string().min(1), value: z.string() })).default([]),
	secrets: z.array(z.object({ key: z.string().min(1), value: z.string() })).default([]),
	domains: z.array(z.object({ host: z.string().min(1), port: z.number().int() })).default([]),
	// `subPath` mounts a subdirectory at `mountPath` instead of the volume root — for images that initdb into the root, where ext4's lost+found blocks init.
	volumes: z
		.array(z.object({ name: z.string().min(1), mountPath: z.string().min(1), size: z.string().min(1), subPath: cleanRelativeSubPath.optional() }))
		.default([]),
	// Files rendered at instantiation (placeholders allowed in `content`) and mounted at `path`; stored encrypted at rest.
	configFiles: z.array(z.object({ path: z.string().min(1), content: z.string() })).default([]),
	// Optional container entrypoint/command override (e.g. Supabase edge-runtime `start --main-service ...`).
	command: z.array(z.string()).optional(),
	args: z.array(z.string()).optional()
});

export const templateServiceSchema = z.object({
	name: slug,
	primary: z.boolean().default(false),
	type: z.literal('docker-image'),
	config: templateServiceConfigSchema
});

export const templateSchema = z.object({
	id: slug,
	name: z.string().min(1),
	description: z.string().min(1),
	category: z.string().min(1),
	tags: z.array(z.string()).default([]),
	logo: z.string().min(1),
	documentation: z.string().url(),
	schemaVersion: z.number().int().positive(),
	version: z.number().int().positive(),
	inputs: z.array(templateInputSchema).default([]),
	secrets: z.array(templateSecretSchema).default([]),
	services: z.array(templateServiceSchema).min(1)
});
export type Template = z.infer<typeof templateSchema>;

// Built catalog entry = template + inlined logo SVG (so logos ship out-of-band with the catalog).
export const catalogTemplateSchema = templateSchema.extend({ logoSvg: z.string().min(1) });
export type CatalogTemplate = z.infer<typeof catalogTemplateSchema>;

export const catalogSchema = z.array(catalogTemplateSchema);
export type Catalog = z.infer<typeof catalogSchema>;
