import { ApiError } from '../../../shared/errors/api-error.js';

export class PlatformUserNotFoundError extends ApiError {
	constructor() {
		super(404, 'user_not_found');
	}
}

export class PlatformLastAdminError extends ApiError {
	constructor() {
		super(409, 'last_admin');
	}
}

export class PlatformSelfDemotionError extends ApiError {
	constructor() {
		super(409, 'self_demotion');
	}
}

export class PlatformSelfDeleteError extends ApiError {
	constructor() {
		super(409, 'self_delete');
	}
}
