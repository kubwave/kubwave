import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const createAgentSchema = z.object({ name: z.string().trim().min(1).max(80), maxConcurrentBuilds: z.number().int().min(1).max(32) });
export const updateAgentSchema = z.object({ paused: z.boolean(), maxConcurrentBuilds: z.number().int().min(1).max(32) });
export const registerAgentSchema = z.object({ token: z.string().min(32).max(200) });
export const heartbeatSchema = z.object({
	protocolVersion: z.number().int(),
	version: z.string().max(80),
	architecture: z.enum(['amd64', 'arm64']),
	cpus: z.number().int().min(1).max(4096),
	memoryBytes: z.number().finite().positive(),
	freeDiskBytes: z.number().finite().nonnegative(),
	dockerReady: z.boolean(),
	tasks: z.array(z.object({ id: z.uuid(), attempt: z.number().int().min(1), leaseToken: z.string().min(32).max(200) })).max(32)
});
export const taskReportSchema = z.object({ attempt: z.number().int().min(1), leaseToken: z.string().min(32).max(200) });
export const taskLogsSchema = taskReportSchema.extend({
	lines: z
		.array(z.object({ sequence: z.number().int().min(0), container: z.string().min(1).max(80), message: z.string().max(8192), ts: z.iso.datetime() }))
		.max(100)
});
export const taskResultSchema = taskReportSchema.extend({ success: z.boolean(), error: z.string().max(2000).optional() });
export const taskSourceSchema = taskReportSchema.extend({ commit: z.string().regex(/^[0-9a-f]{40,64}$/) });
export const agentIdSchema = z.uuid();

export class CreateBuildAgentDto {
	@ApiProperty() name!: string;
	@ApiProperty({ minimum: 1, maximum: 32 }) maxConcurrentBuilds!: number;
}
export class UpdateBuildAgentDto {
	@ApiProperty() paused!: boolean;
	@ApiProperty({ minimum: 1, maximum: 32 }) maxConcurrentBuilds!: number;
}
export class BuildAgentDto extends CreateBuildAgentDto {
	@ApiProperty() id!: string;
	@ApiProperty() paused!: boolean;
	@ApiProperty({ enum: ['pending', 'online', 'offline', 'paused', 'revoked', 'incompatible', 'unavailable'] }) status!: string;
	@ApiProperty({ nullable: true, type: String }) lastSeenAt!: string | null;
	@ApiProperty({ nullable: true, type: String }) version!: string | null;
	@ApiProperty({ nullable: true, type: String }) architecture!: string | null;
	@ApiProperty() activeBuilds!: number;
	@ApiProperty({ nullable: true, type: Number }) cpus!: number | null;
	@ApiProperty({ nullable: true, type: Number }) memoryBytes!: number | null;
	@ApiProperty({ nullable: true, type: Number }) freeDiskBytes!: number | null;
}
export class BuildAgentRegistrationDto {
	@ApiProperty() id!: string;
	@ApiProperty() installCommand!: string;
	@ApiProperty() expiresAt!: string;
}
export class RegisterBuildAgentDto {
	@ApiProperty() token!: string;
}
export class BuildAgentCredentialsDto {
	@ApiProperty() id!: string;
	@ApiProperty() token!: string;
}
export class TaskLeaseDto {
	@ApiProperty() id!: string;
	@ApiProperty() attempt!: number;
	@ApiProperty() leaseToken!: string;
}
export class AgentHeartbeatDto {
	@ApiProperty() protocolVersion!: number;
	@ApiProperty() version!: string;
	@ApiProperty({ enum: ['amd64', 'arm64'] }) architecture!: 'amd64' | 'arm64';
	@ApiProperty() cpus!: number;
	@ApiProperty() memoryBytes!: number;
	@ApiProperty() freeDiskBytes!: number;
	@ApiProperty() dockerReady!: boolean;
	@ApiProperty({ type: [TaskLeaseDto] }) tasks!: TaskLeaseDto[];
}
export class AgentHeartbeatResponseDto {
	@ApiProperty() leaseExpiresAt!: string;
	@ApiProperty({ type: [String] }) canceled!: string[];
}
export class AgentLogLineDto {
	@ApiProperty() sequence!: number;
	@ApiProperty() container!: string;
	@ApiProperty() message!: string;
	@ApiProperty() ts!: string;
}
export class AgentTaskLogsDto {
	@ApiProperty() attempt!: number;
	@ApiProperty() leaseToken!: string;
	@ApiProperty({ type: [AgentLogLineDto] }) lines!: AgentLogLineDto[];
}
export class AgentTaskResultDto {
	@ApiProperty() attempt!: number;
	@ApiProperty() leaseToken!: string;
	@ApiProperty() success!: boolean;
	@ApiPropertyOptional() error?: string;
}
export class AgentTaskSourceDto {
	@ApiProperty() attempt!: number;
	@ApiProperty() leaseToken!: string;
	@ApiProperty() commit!: string;
}
export class AgentTaskDto extends TaskLeaseDto {
	@ApiProperty() leaseExpiresAt!: string;
	@ApiProperty() timeoutSeconds!: number;
	@ApiProperty() imageRef!: string;
	@ApiProperty({ type: Object, additionalProperties: true }) job!: object;
	@ApiProperty({ type: Object, additionalProperties: true }) files!: object;
	@ApiProperty({ type: [String] }) redactions!: string[];
}
export class AgentClaimDto {
	@ApiProperty({ nullable: true, type: AgentTaskDto }) task!: AgentTaskDto | null;
}
export class AgentOkDto {
	@ApiProperty() ok!: boolean;
}
