import { ApiProperty } from '@nestjs/swagger';
import type { PlatformVolume } from '@kubwave/kube';

export class PlatformVolumeDto {
	@ApiProperty({ enum: ['registry', 'postgres', 'prometheus'] })
	volume!: PlatformVolume;

	@ApiProperty({ type: Boolean })
	available!: boolean;

	@ApiProperty({ type: Number })
	usedBytes!: number;

	@ApiProperty({ type: Number })
	capacityBytes!: number;

	@ApiProperty({ type: String, nullable: true })
	sampledAt!: string | null;

	@ApiProperty({ type: Number, nullable: true })
	capBytes!: number | null;
}

export class PlatformVolumesDto {
	@ApiProperty({ type: String })
	sampledAt!: string;

	@ApiProperty({ type: [PlatformVolumeDto] })
	volumes!: PlatformVolumeDto[];
}
