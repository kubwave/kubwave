import { ApiError } from '../../shared/errors/api-error.js';

export class ProjectNotFoundError extends ApiError {
	constructor() {
		super(404, 'project_not_found');
	}
}

export class ProjectNameTakenError extends ApiError {
	constructor() {
		super(409, 'project_name_taken');
	}
}

export class ProjectEnvironmentNotFoundError extends ApiError {
	constructor() {
		super(404, 'environment_not_found');
	}
}
