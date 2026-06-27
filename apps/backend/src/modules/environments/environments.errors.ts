import { ApiError } from '../../shared/errors/api-error.js';

export class EnvironmentNotFoundError extends ApiError {
	constructor() {
		super(404, 'environment_not_found');
	}
}

export class EnvironmentNameTakenError extends ApiError {
	constructor() {
		super(409, 'environment_name_taken');
	}
}

export class LastEnvironmentError extends ApiError {
	constructor() {
		super(409, 'last_environment');
	}
}

export class PreviewEnvironmentImmutableError extends ApiError {
	constructor() {
		super(409, 'preview_environment_immutable');
	}
}
