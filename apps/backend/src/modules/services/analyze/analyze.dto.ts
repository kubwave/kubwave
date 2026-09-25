import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { z } from 'zod';
import { DATABASE_ENGINES } from '@kubwave/db/database-engines';
import type { DatabaseEngine } from '@kubwave/db';
import { githubRepoConfigSchema, privateRepoConfigSchema, publicRepoConfigSchema, serviceDomainSchema } from '../services.dto.js';

const databaseEngineSchema = z.enum(DATABASE_ENGINES as [DatabaseEngine, ...DatabaseEngine[]]);
const branchSchema = publicRepoConfigSchema.shape.branch;

export const repoSourceSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('public-repo'), repoUrl: publicRepoConfigSchema.shape.repoUrl, branch: branchSchema }),
	z.object({
		type: z.literal('private-repo'),
		repoUrl: privateRepoConfigSchema.shape.repoUrl,
		sshKeyId: privateRepoConfigSchema.shape.sshKeyId,
		branch: branchSchema
	}),
	z.object({
		type: z.literal('github-repo'),
		installationId: githubRepoConfigSchema.shape.installationId,
		repoFullName: githubRepoConfigSchema.shape.repoFullName,
		branch: branchSchema
	}),
	z.object({
		type: z.literal('gitea-repo'),
		installationId: githubRepoConfigSchema.shape.installationId,
		repoFullName: githubRepoConfigSchema.shape.repoFullName,
		branch: branchSchema
	})
]);
export type RepoSource = z.infer<typeof repoSourceSchema>;

export const analyzeRepositorySchema = z.object({ source: repoSourceSchema });
export type AnalyzeRepositoryInput = z.infer<typeof analyzeRepositorySchema>;

export const PLAN_REFERENCE_KINDS = ['url', 'publicUrl', 'connectionUri', 'env'] as const;
export type PlanReferenceKind = (typeof PLAN_REFERENCE_KINDS)[number];

// What the model must return. Deliberately constraint-free (no lengths, bounds, or optionals) so every provider's structured-output mode accepts it.
const planReferenceSchema = z.object({
	service: z.string(),
	kind: z.enum(PLAN_REFERENCE_KINDS),
	key: z.string().nullable().describe('For kind "env": the env key of the target service whose value to copy; null otherwise.')
});

const planEnvSchema = z.object({
	key: z.string(),
	value: z.string().nullable().describe('A safe default from an env template or compose file, or null when the user must supply it.'),
	secret: z.boolean(),
	generate: z
		.boolean()
		.describe('True for random passwords/keys that only need to be unguessable (JWT, session, encryption keys, image root passwords).'),
	reference: planReferenceSchema.nullable().describe('Set when the value points at another service instead of a literal.'),
	note: z.string().nullable()
});

export const deploymentPlanSchema = z.object({
	services: z.array(
		z.object({
			name: z.string().describe('Lowercase, dash-separated service name, unique in the environment.'),
			rootDirectory: z.string().describe('Build context relative to the repo root; empty string for the root.'),
			builder: z.enum(['nixpacks', 'dockerfile']),
			dockerfilePath: z.string().nullable().describe('Relative to rootDirectory; only for the dockerfile builder.'),
			buildCommand: z.string().nullable(),
			startCommand: z.string().nullable(),
			containerPort: z.number().nullable().describe('Port the app listens on; null for workers without an HTTP port.'),
			watchPaths: z.array(z.string()).describe('Repo-relative paths whose changes should redeploy this service.'),
			publicDomain: z.boolean().describe('Whether the service should get a public default domain.'),
			env: z.array(planEnvSchema),
			reason: z.string().describe('One sentence on why this is a deployable service.')
		})
	),
	images: z.array(
		z.object({
			name: z.string(),
			image: z.string().describe('Image repository without tag, e.g. "minio/minio".'),
			tag: z.string(),
			containerPort: z.number().nullable(),
			args: z.array(z.string()).describe('Arguments for the image entrypoint (compose "command"); empty for the image default.'),
			volumes: z.array(z.object({ name: z.string(), mountPath: z.string(), size: z.string().describe('Kubernetes quantity, e.g. "5Gi".') })),
			publicDomain: z.boolean(),
			env: z.array(planEnvSchema),
			reason: z.string()
		})
	),
	databases: z.array(z.object({ name: z.string(), engine: databaseEngineSchema })),
	questions: z.array(
		z.object({
			kind: z.enum(['domain', 'values']),
			title: z.string(),
			description: z.string().nullable(),
			services: z.array(z.string()).describe('Services the answer applies to.'),
			envKeys: z.array(z.string()).describe('For "values" questions: the env keys the user fills in; empty for "domain".')
		})
	),
	warnings: z.array(z.string())
});
export type DeploymentPlan = z.infer<typeof deploymentPlanSchema>;
export type AnalyzeRepositoryResult = DeploymentPlan & { defaultDomainBase: string | null };

const planServiceNameSchema = z.string().trim().min(1).max(100);

const planEnvInputSchema = z
	.array(
		z.object({
			key: z.string().trim().min(1).max(128),
			value: z.string().max(4000).nullable(),
			secret: z.boolean(),
			generate: z.boolean().default(false),
			reference: z
				.object({ service: planServiceNameSchema, kind: z.enum(PLAN_REFERENCE_KINDS), key: z.string().trim().max(128).nullable().default(null) })
				.nullable()
		})
	)
	.max(200);

export const createServicesFromPlanSchema = z.object({
	source: repoSourceSchema,
	autoDeploy: z.boolean().default(false),
	services: z
		.array(
			z.object({
				name: planServiceNameSchema,
				rootDirectory: z.string().trim().max(255),
				builder: z.enum(['nixpacks', 'dockerfile']),
				dockerfilePath: z.string().trim().max(255).nullable(),
				buildCommand: z.string().trim().max(4000).nullable(),
				startCommand: z.string().trim().max(4000).nullable(),
				containerPort: z.number().int().min(1).max(65535).nullable(),
				watchPaths: z.array(z.string().trim().max(255)).max(20),
				publicDomain: z.boolean(),
				domain: serviceDomainSchema.shape.host.nullable().default(null),
				env: planEnvInputSchema
			})
		)
		.min(1)
		.max(20),
	images: z
		.array(
			z.object({
				name: planServiceNameSchema,
				image: z.string().trim().min(1).max(255),
				tag: z.string().trim().min(1).max(128),
				containerPort: z.number().int().min(1).max(65535).nullable(),
				args: z.array(z.string().max(4096)).max(64),
				volumes: z
					.array(z.object({ name: z.string().trim().max(63), mountPath: z.string().trim().max(512), size: z.string().trim().max(20) }))
					.max(10),
				publicDomain: z.boolean(),
				domain: serviceDomainSchema.shape.host.nullable().default(null),
				env: planEnvInputSchema
			})
		)
		.max(10)
		.default([]),
	databases: z.array(z.object({ name: planServiceNameSchema, engine: databaseEngineSchema })).max(10)
});
export type CreateServicesFromPlanInput = z.infer<typeof createServicesFromPlanSchema>;

export class AiStatusDto {
	@ApiProperty({ type: Boolean }) enabled!: boolean;
}

export class RepoSourceDto {
	@ApiProperty({ enum: ['public-repo', 'private-repo', 'github-repo', 'gitea-repo'] })
	type!: RepoSource['type'];

	@ApiProperty({ type: String })
	branch!: string;

	@ApiPropertyOptional({ type: String })
	repoUrl?: string;

	@ApiPropertyOptional({ type: String, format: 'uuid' })
	sshKeyId?: string;

	@ApiPropertyOptional({ type: String, format: 'uuid' })
	installationId?: string;

	@ApiPropertyOptional({ type: String })
	repoFullName?: string;
}

export class AnalyzeRepositoryDto {
	@ApiProperty({ type: RepoSourceDto })
	source!: RepoSourceDto;
}

export class PlanReferenceDto {
	@ApiProperty({ type: String }) service!: string;
	@ApiProperty({ enum: PLAN_REFERENCE_KINDS }) kind!: PlanReferenceKind;
	@ApiProperty({ type: String, nullable: true, description: 'Env key to copy for kind "env".' }) key!: string | null;
}

export class PlanEnvVarDto {
	@ApiProperty({ type: String }) key!: string;
	@ApiProperty({ type: String, nullable: true }) value!: string | null;
	@ApiProperty({ type: Boolean }) secret!: boolean;
	@ApiProperty({ type: Boolean }) generate!: boolean;
	@ApiProperty({ type: PlanReferenceDto, nullable: true }) reference!: PlanReferenceDto | null;
	@ApiProperty({ type: String, nullable: true }) note!: string | null;
}

export class PlanServiceDto {
	@ApiProperty({ type: String }) name!: string;
	@ApiProperty({ type: String }) rootDirectory!: string;
	@ApiProperty({ enum: ['nixpacks', 'dockerfile'] }) builder!: 'nixpacks' | 'dockerfile';
	@ApiProperty({ type: String, nullable: true }) dockerfilePath!: string | null;
	@ApiProperty({ type: String, nullable: true }) buildCommand!: string | null;
	@ApiProperty({ type: String, nullable: true }) startCommand!: string | null;
	@ApiProperty({ type: Number, nullable: true }) containerPort!: number | null;
	@ApiProperty({ type: [String] }) watchPaths!: string[];
	@ApiProperty({ type: Boolean }) publicDomain!: boolean;
	@ApiProperty({ type: [PlanEnvVarDto] }) env!: PlanEnvVarDto[];
	@ApiProperty({ type: String }) reason!: string;
}

export class PlanEnvVarInputDto extends OmitType(PlanEnvVarDto, ['note'] as const) {}

export class PlanServiceInputDto extends OmitType(PlanServiceDto, ['env', 'reason'] as const) {
	@ApiProperty({ type: [PlanEnvVarInputDto] }) env!: PlanEnvVarInputDto[];
	@ApiPropertyOptional({ type: String, nullable: true, description: 'Custom public hostname; null uses the generated default domain.' })
	domain?: string | null;
}

export class PlanVolumeDto {
	@ApiProperty({ type: String }) name!: string;
	@ApiProperty({ type: String }) mountPath!: string;
	@ApiProperty({ type: String }) size!: string;
}

export class PlanImageDto {
	@ApiProperty({ type: String }) name!: string;
	@ApiProperty({ type: String }) image!: string;
	@ApiProperty({ type: String }) tag!: string;
	@ApiProperty({ type: Number, nullable: true }) containerPort!: number | null;
	@ApiProperty({ type: [String] }) args!: string[];
	@ApiProperty({ type: [PlanVolumeDto] }) volumes!: PlanVolumeDto[];
	@ApiProperty({ type: Boolean }) publicDomain!: boolean;
	@ApiProperty({ type: [PlanEnvVarDto] }) env!: PlanEnvVarDto[];
	@ApiProperty({ type: String }) reason!: string;
}

export class PlanImageInputDto extends OmitType(PlanImageDto, ['env', 'reason'] as const) {
	@ApiProperty({ type: [PlanEnvVarInputDto] }) env!: PlanEnvVarInputDto[];
	@ApiPropertyOptional({ type: String, nullable: true }) domain?: string | null;
}

export class PlanDatabaseDto {
	@ApiProperty({ type: String }) name!: string;
	@ApiProperty({ enum: DATABASE_ENGINES }) engine!: DatabaseEngine;
}

export class PlanQuestionDto {
	@ApiProperty({ enum: ['domain', 'values'] }) kind!: 'domain' | 'values';
	@ApiProperty({ type: String }) title!: string;
	@ApiProperty({ type: String, nullable: true }) description!: string | null;
	@ApiProperty({ type: [String] }) services!: string[];
	@ApiProperty({ type: [String] }) envKeys!: string[];
}

export class DeploymentPlanDto implements AnalyzeRepositoryResult {
	@ApiProperty({ type: [PlanServiceDto] }) services!: PlanServiceDto[];
	@ApiProperty({ type: [PlanImageDto] }) images!: PlanImageDto[];
	@ApiProperty({ type: [PlanDatabaseDto] }) databases!: PlanDatabaseDto[];
	@ApiProperty({ type: [PlanQuestionDto] }) questions!: PlanQuestionDto[];
	@ApiProperty({ type: [String] }) warnings!: string[];
	@ApiProperty({ type: String, nullable: true, description: 'Base of generated service domains, or null when default domains are unavailable.' })
	defaultDomainBase!: string | null;
}

export class CreateServicesFromPlanDto {
	@ApiProperty({ type: RepoSourceDto }) source!: RepoSourceDto;
	@ApiPropertyOptional({ type: Boolean, default: false }) autoDeploy?: boolean;
	@ApiProperty({ type: [PlanServiceInputDto] }) services!: PlanServiceInputDto[];
	@ApiPropertyOptional({ type: [PlanImageInputDto] }) images?: PlanImageInputDto[];
	@ApiProperty({ type: [PlanDatabaseDto] }) databases!: PlanDatabaseDto[];
}
