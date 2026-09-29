import type { InvitationsListResponse, PlatformUsersListResponse } from '@kubwave/api-client';

export type AdminUser = PlatformUsersListResponse[number];
export type Invitation = InvitationsListResponse[number];

export const PAGE_SIZE = 10;

const normalize = (query: string) => query.trim().toLowerCase();

export function filterUsers(users: readonly AdminUser[], query: string): AdminUser[] {
	const needle = normalize(query);
	return users.filter(user => !needle || user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle));
}

export function filterInvitations(invitations: readonly Invitation[], query: string): Invitation[] {
	const needle = normalize(query);
	return invitations.filter(invitation => !needle || invitation.email.toLowerCase().includes(needle));
}

// Accepted invitations became members; expired ones stay so they can be resent.
export function openInvitations(invitations: readonly Invitation[]): Invitation[] {
	return invitations.filter(invitation => invitation.status !== 'accepted');
}

// Clamps the page into range as the list shrinks instead of resetting to 1, so a background refetch doesn't yank the user off their page.
export function pageOf<T>(items: readonly T[], page: number, size = PAGE_SIZE): { page: number; pageCount: number; items: T[] } {
	const pageCount = Math.max(1, Math.ceil(items.length / size));
	const current = Math.min(Math.max(1, page), pageCount);
	return { page: current, pageCount, items: items.slice((current - 1) * size, current * size) };
}

export function expiryLabel(expiresAt: string, now = Date.now()): string {
	const delta = Date.parse(expiresAt) - now;
	const hours = Math.floor(Math.abs(delta) / 3_600_000);
	const span = hours < 24 ? `${Math.max(1, hours)}h` : `${Math.round(hours / 24)}d`;
	return delta > 0 ? `expires in ${span}` : `expired ${span} ago`;
}

export function userErrorMessage(code: string): string {
	switch (code) {
		case 'last_admin':
			return "You can't remove the last admin.";
		case 'self_demotion':
			return "You can't remove your own admin access.";
		case 'self_delete':
			return "You can't delete your own account.";
		case 'user_not_found':
			return 'That user no longer exists.';
		default:
			return 'Something went wrong. Please try again.';
	}
}
