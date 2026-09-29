import { describe, expect, test } from 'bun:test';
import {
	expiryLabel,
	filterInvitations,
	filterUsers,
	openInvitations,
	pageOf,
	userErrorMessage,
	type AdminUser,
	type Invitation
} from '../features/admin-users/model';

const user = (id: string, name: string, email: string): AdminUser => ({ id, name, email, isAdmin: false, createdAt: '', updatedAt: '' });
const invitation = (id: string, email: string, status: Invitation['status']): Invitation => ({
	id,
	email,
	status,
	isAdmin: false,
	invitedBy: null,
	expiresAt: '',
	acceptedAt: null,
	createdAt: ''
});

describe('filterUsers', () => {
	const users = [user('1', 'Ada Lovelace', 'ada@example.com'), user('2', 'Alan Turing', 'alan@kubwave.dev')];

	test('matches name or email, case-insensitively', () => {
		expect(filterUsers(users, 'LOVE').map(u => u.id)).toEqual(['1']);
		expect(filterUsers(users, 'kubwave.dev').map(u => u.id)).toEqual(['2']);
		expect(filterUsers(users, ' ')).toHaveLength(2);
	});
});

describe('filterInvitations', () => {
	test('matches the email only', () => {
		const invitations = [invitation('1', 'ops@example.com', 'pending'), invitation('2', 'dev@example.com', 'pending')];
		expect(filterInvitations(invitations, 'OPS').map(i => i.id)).toEqual(['1']);
		expect(filterInvitations(invitations, 'pending')).toEqual([]);
	});
});

describe('openInvitations', () => {
	test('hides accepted invitations but keeps expired ones to resend', () => {
		const list = [invitation('1', 'a@x.io', 'pending'), invitation('2', 'b@x.io', 'accepted'), invitation('3', 'c@x.io', 'expired')];
		expect(openInvitations(list).map(i => i.id)).toEqual(['1', '3']);
	});
});

describe('pageOf', () => {
	const items = Array.from({ length: 23 }, (_, i) => i);

	test('slices the requested page', () => {
		expect(pageOf(items, 2, 10)).toEqual({ page: 2, pageCount: 3, items: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19] });
	});

	test('clamps a page past the end instead of showing nothing', () => {
		expect(pageOf(items.slice(0, 5), 3, 10)).toEqual({ page: 1, pageCount: 1, items: [0, 1, 2, 3, 4] });
	});

	test('an empty list still has one page', () => {
		expect(pageOf([], 1, 10)).toEqual({ page: 1, pageCount: 1, items: [] });
	});
});

describe('userErrorMessage', () => {
	test('explains the guarded admin actions', () => {
		expect(userErrorMessage('last_admin')).toBe("You can't remove the last admin.");
		expect(userErrorMessage('self_demotion')).toBe("You can't remove your own admin access.");
		expect(userErrorMessage('self_delete')).toBe("You can't delete your own account.");
		expect(userErrorMessage('user_not_found')).toBe('That user no longer exists.');
		expect(userErrorMessage('boom')).toBe('Something went wrong. Please try again.');
	});
});

describe('expiryLabel', () => {
	const now = Date.parse('2026-09-28T12:00:00Z');

	test('counts down days, then hours', () => {
		expect(expiryLabel('2026-10-05T12:00:00Z', now)).toBe('expires in 7d');
		expect(expiryLabel('2026-10-05T11:59:00Z', now)).toBe('expires in 7d');
		expect(expiryLabel('2026-09-28T17:30:00Z', now)).toBe('expires in 5h');
		expect(expiryLabel('2026-09-28T12:10:00Z', now)).toBe('expires in 1h');
	});

	test('a past date has expired', () => {
		expect(expiryLabel('2026-09-26T12:00:00Z', now)).toBe('expired 2d ago');
	});
});
