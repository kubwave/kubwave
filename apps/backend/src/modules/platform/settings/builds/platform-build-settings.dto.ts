import { ApiProperty } from '@nestjs/swagger';
import type { BuildSettings } from '../../../../shared/builds/settings.js';

export class BuildSettingsDto implements BuildSettings {
	@ApiProperty({ enum: ['cluster', 'agent'] }) execution!: 'cluster' | 'agent';
	@ApiProperty() cpuRequest!: string;
	@ApiProperty() cpuLimit!: string;
	@ApiProperty() memoryRequest!: string;
	@ApiProperty() memoryLimit!: string;
	@ApiProperty({ minimum: 1, maximum: 100 }) maxConcurrentBuilds!: number;
	@ApiProperty({ minimum: 60, maximum: 86400 }) timeoutSeconds!: number;
	@ApiProperty({ minimum: 60, maximum: 604800 }) queueTimeoutSeconds!: number;
	@ApiProperty() fallbackToCluster!: boolean;
}
