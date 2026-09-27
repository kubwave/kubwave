import { Module } from '@nestjs/common';
import { McpAuthService } from './mcp-auth.service.js';
import { McpController } from './mcp.controller.js';
import { McpOauthController } from './mcp-oauth.controller.js';

@Module({ controllers: [McpController, McpOauthController], providers: [McpAuthService], exports: [McpAuthService] })
export class McpModule {}
