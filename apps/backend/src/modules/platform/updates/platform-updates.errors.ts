import { ApiError } from '../../../shared/errors/api-error.js';

export class UpdateConcurrentError extends ApiError {
	constructor() {
		super(409, 'concurrent_update');
	}
}

export class UpdateInvalidTargetVersionError extends ApiError {
	constructor(version: string) {
		super(400, `invalid_target_version: ${version}`);
	}
}

export class UpdateRunNotFoundError extends ApiError {
	constructor() {
		super(404, 'update_run_not_found');
	}
}
