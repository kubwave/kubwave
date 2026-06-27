import { ApiError } from '../../shared/errors/api-error.js';

export class TeamNotFoundError extends ApiError {
	constructor() {
		super(404, 'team_not_found');
	}
}

export class TeamForbiddenError extends ApiError {
	constructor() {
		super(403, 'team_forbidden');
	}
}

export class MemberNotFoundError extends ApiError {
	constructor() {
		super(404, 'member_not_found');
	}
}

export class TeamUserNotFoundError extends ApiError {
	constructor() {
		super(404, 'user_not_found');
	}
}

export class AlreadyMemberError extends ApiError {
	constructor() {
		super(409, 'already_member');
	}
}

export class LastOwnerError extends ApiError {
	constructor() {
		super(409, 'last_owner');
	}
}
