import { ApiError } from '../../shared/errors/api-error.js';

export class DeploymentNotFoundError extends ApiError {
	constructor() {
		super(404, 'deployment_not_found');
	}
}

export class DeploymentNotCancelableError extends ApiError {
	constructor() {
		super(409, 'deployment_not_cancelable');
	}
}
