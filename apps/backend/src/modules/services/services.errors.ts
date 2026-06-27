import { ApiError } from '../../shared/errors/api-error.js';

export class ServiceNotFoundError extends ApiError {
	constructor() {
		super(404, 'service_not_found');
	}
}

export class ServiceNameTakenError extends ApiError {
	constructor() {
		super(409, 'service_name_taken');
	}
}

export class VolumeShrinkError extends ApiError {
	constructor(volumeName: string) {
		super(400, 'volume_cannot_shrink', { message: `Volume "${volumeName}" can only be grown, not shrunk.` });
	}
}

export class ServiceConfigTypeMismatchError extends ApiError {
	constructor() {
		super(400, 'service_config_type_mismatch', { message: 'The submitted config does not match the service type.' });
	}
}

export class SshKeyNotAvailableError extends ApiError {
	constructor() {
		super(400, 'ssh_key_not_available', { message: 'Select a deploy key that belongs to this team.' });
	}
}

export class InvalidDatabaseVersionError extends ApiError {
	constructor(version: string) {
		super(400, 'invalid_database_version', { message: `Version "${version}" is not available for this database engine.` });
	}
}

export class NotADatabaseServiceError extends ApiError {
	constructor() {
		super(400, 'not_a_database_service', { message: 'Connection details are only available for managed databases.' });
	}
}

export class ComposeImportError extends ApiError {
	constructor(
		status: number,
		public readonly issues: string[]
	) {
		super(status, 'compose_import_failed', { message: issues.join('\n'), issues });
	}
}
