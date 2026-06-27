import { ApiError } from '../../shared/errors/api-error.js';

export class InviteEmailInUseError extends ApiError {
	constructor() {
		super(409, 'email_in_use');
	}
}

export class InviteNotFoundError extends ApiError {
	constructor() {
		super(404, 'invite_not_found');
	}
}

export class InviteExpiredError extends ApiError {
	constructor() {
		super(409, 'invite_expired');
	}
}

export class InviteAlreadyUsedError extends ApiError {
	constructor() {
		super(409, 'invite_already_used');
	}
}
