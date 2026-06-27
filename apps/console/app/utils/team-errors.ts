// Map API error codes to human-readable messages. Shared between the team
// SettingsForm (rename) and the settings page (delete).
export function teamErrorMessage(error: string): string {
	switch (error) {
		case 'team_forbidden':
			return 'Only owners can change team settings.';
		case 'last_owner':
			return 'A team must keep at least one owner.';
		case 'team_not_found':
			return 'This team is no longer available to you.';
		default:
			return 'Something went wrong. Please try again.';
	}
}
