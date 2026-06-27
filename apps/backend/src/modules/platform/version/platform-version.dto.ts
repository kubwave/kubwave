import { ApiProperty } from '@nestjs/swagger';

export interface AvailableVersion {
	version: string;
	changelogUrl: string | null;
	publishedAt: string | null;
}

export interface VersionState {
	latestVersion: string | null;
	availableVersions: AvailableVersion[];
	lastCheckedAt: string | null;
	lastEtag: string | null;
}

export class AvailableVersionDto implements AvailableVersion {
	@ApiProperty({ type: String })
	version!: string;

	@ApiProperty({ type: String, nullable: true })
	changelogUrl!: string | null;

	@ApiProperty({ type: String, nullable: true })
	publishedAt!: string | null;
}

export class PlatformVersionInfoDto {
	@ApiProperty({ type: String })
	currentVersion!: string;

	@ApiProperty({ type: String, nullable: true })
	latestVersion!: string | null;

	@ApiProperty({ type: [AvailableVersionDto] })
	availableVersions!: AvailableVersionDto[];

	@ApiProperty({ type: String, nullable: true })
	lastCheckedAt!: string | null;
}

export class PlatformVersionCheckResultDto {
	@ApiProperty({ type: Boolean })
	success!: boolean;

	@ApiProperty({ type: String })
	message!: string;
}
