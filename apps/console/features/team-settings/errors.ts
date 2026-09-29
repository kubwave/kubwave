type ToastMessage = { title: string; description: string };

const FALLBACK = 'Something went wrong. Please try again.';

export function memberErrorMessage(code: string): string {
	switch (code) {
		case 'last_owner':
			return 'A team must keep at least one owner. Delete the team instead.';
		case 'team_forbidden':
			return 'Only owners can do that.';
		case 'member_not_found':
			return 'That member is no longer in the team.';
		case 'team_not_found':
			return 'This team is no longer available to you.';
		default:
			return FALLBACK;
	}
}

export function addMemberError(code: string): ToastMessage {
	switch (code) {
		case 'user_not_found':
			return { title: 'No user with that email', description: 'The person must already have an account.' };
		case 'already_member':
			return { title: 'Already a member', description: 'That person is already in this team.' };
		case 'team_forbidden':
			return { title: 'Not allowed', description: 'Only owners can add members.' };
		default:
			return { title: 'Could not add member', description: 'Please try again.' };
	}
}

export function sshKeyCreateError(code: string): ToastMessage {
	switch (code) {
		case 'invalid_ssh_key':
			return { title: 'Invalid key', description: 'That does not look like a valid SSH private key.' };
		case 'ssh_key_passphrase_protected':
			return { title: 'Passphrase-protected key', description: 'Remove the passphrase before uploading — it cannot be used unattended.' };
		case 'ssh_key_name_taken':
			return { title: 'Name already in use', description: 'This team already has an SSH key with that name.' };
		case 'team_forbidden':
			return { title: 'Not allowed', description: 'Only owners can add SSH keys.' };
		default:
			return { title: 'Could not add SSH key', description: 'Please try again.' };
	}
}

export function sshKeyDeleteErrorMessage(code: string): string {
	switch (code) {
		case 'ssh_key_not_found':
			return 'That key no longer exists.';
		case 'team_forbidden':
			return 'Only owners can delete SSH keys.';
		case 'team_not_found':
			return 'This team is no longer available to you.';
		default:
			return FALLBACK;
	}
}
