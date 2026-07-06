import { ApiProperty } from '@nestjs/swagger';

export class GithubManifestDto {
	@ApiProperty({ type: String, description: 'POST the form here (carries the signed state in its query).' })
	postUrl!: string;

	@ApiProperty({ type: String, description: 'JSON string to submit as the `manifest` form field.' })
	manifest!: string;
}

export class GithubConnectionDto {
	@ApiProperty({ type: Boolean })
	connected!: boolean;

	@ApiProperty({ type: String, nullable: true })
	appSlug!: string | null;

	@ApiProperty({ type: String, nullable: true })
	appId!: string | null;

	@ApiProperty({ type: String, nullable: true, description: 'Send the admin here to install the App on their repositories.' })
	installUrl!: string | null;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	connectedAt!: string | null;
}
