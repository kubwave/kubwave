import { ApiError } from '../../../shared/errors/api-error.js';

export class SshKeyNotFoundError extends ApiError {
	constructor() {
		super(404, 'ssh_key_not_found');
	}
}

export class SshKeyNameTakenError extends ApiError {
	constructor() {
		super(409, 'ssh_key_name_taken');
	}
}

export class InvalidSshKeyError extends ApiError {
	constructor() {
		super(400, 'invalid_ssh_key');
	}
}

export class SshKeyPassphraseError extends ApiError {
	constructor() {
		super(400, 'ssh_key_passphrase_protected');
	}
}
