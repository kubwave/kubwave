import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MCP_SCOPES } from './mcp.schemas.js';

export class McpAccessInputDto {
	@ApiProperty() name!: string;
	@ApiProperty({ type: [String], enum: MCP_SCOPES }) scopes!: string[];
	@ApiPropertyOptional({ type: String, format: 'uuid' }) teamId?: string;
	@ApiPropertyOptional({ type: [String] }) projectIds?: string[];
	@ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 }) expiresInDays?: number;
}

export class McpAccessDto {
	@ApiProperty() id!: string;
	@ApiProperty() name!: string;
	@ApiProperty({ enum: ['personal', 'oauth'] }) kind!: string;
	@ApiProperty({ type: [String] }) scopes!: string[];
	@ApiProperty({ type: String, nullable: true }) teamId!: string | null;
	@ApiProperty({ type: [String] }) projectIds!: string[];
	@ApiProperty() expiresAt!: string;
	@ApiProperty({ type: String, nullable: true }) revokedAt!: string | null;
	@ApiProperty() createdAt!: string;
}

export class McpCreatedAccessDto {
	@ApiProperty() token!: string;
	@ApiProperty({ type: McpAccessDto }) access!: McpAccessDto;
	@ApiProperty() endpoint!: string;
}

export class McpInfoDto {
	@ApiProperty() endpoint!: string;
	@ApiProperty({ type: [String] }) scopes!: string[];
}

export class McpAuthorizationDto {
	@ApiProperty() client_id!: string;
	@ApiProperty() redirect_uri!: string;
	@ApiProperty({ enum: ['code'] }) response_type!: 'code';
	@ApiProperty() code_challenge!: string;
	@ApiProperty({ enum: ['S256'] }) code_challenge_method!: 'S256';
	@ApiProperty() resource!: string;
	@ApiPropertyOptional({ default: 'read' }) scope?: string;
	@ApiPropertyOptional() state?: string;
}

export class McpConsentDto extends McpAuthorizationDto {
	@ApiProperty() approve!: boolean;
	@ApiPropertyOptional({ type: String, format: 'uuid' }) teamId?: string;
	@ApiPropertyOptional({ type: [String] }) projectIds?: string[];
	@ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 }) expiresInDays?: number;
}

export class McpAuthorizationDetailsDto {
	@ApiProperty() clientName!: string;
	@ApiProperty() redirectUri!: string;
	@ApiProperty({ type: [String] }) scopes!: string[];
}

export class McpRedirectDto {
	@ApiProperty() redirectUrl!: string;
}
export class McpOkDto {
	@ApiProperty() ok!: boolean;
}
