import { Injectable } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import { db, users } from '@kubwave/db';
import { PlatformLastAdminError, PlatformSelfDeleteError, PlatformSelfDemotionError, PlatformUserNotFoundError } from './platform-users.errors.js';
import type { UpdatePlatformUserInput } from './platform-users.dto.js';

export interface PlatformUserView {
	id: string;
	name: string;
	email: string;
	isAdmin: boolean;
	createdAt: string;
	updatedAt: string;
}

const userColumns = {
	id: users.id,
	name: users.name,
	email: users.email,
	isAdmin: users.isAdmin,
	createdAt: users.createdAt,
	updatedAt: users.updatedAt
};

function toView(row: { id: string; name: string; email: string; isAdmin: boolean; createdAt: Date; updatedAt: Date }): PlatformUserView {
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		isAdmin: row.isAdmin,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

@Injectable()
export class PlatformUsersService {
	async listUsers(): Promise<PlatformUserView[]> {
		const rows = await db.select(userColumns).from(users).orderBy(desc(users.createdAt));
		return rows.map(toView);
	}

	async updateUser(targetId: string, input: UpdatePlatformUserInput, actingUserId: string): Promise<PlatformUserView> {
		const [target] = await db.select(userColumns).from(users).where(eq(users.id, targetId)).limit(1);
		if (!target) throw new PlatformUserNotFoundError();

		if (input.isAdmin === false && target.isAdmin) {
			if ((await this.adminCount()) <= 1) throw new PlatformLastAdminError();
			if (targetId === actingUserId) throw new PlatformSelfDemotionError();
		}

		const patch: { name?: string; isAdmin?: boolean; updatedAt: Date } = { updatedAt: new Date() };
		if (input.name !== undefined) patch.name = input.name.trim();
		if (input.isAdmin !== undefined) patch.isAdmin = input.isAdmin;

		const [updated] = await db.update(users).set(patch).where(eq(users.id, targetId)).returning(userColumns);
		if (!updated) throw new PlatformUserNotFoundError();
		return toView(updated);
	}

	async deleteUser(targetId: string, actingUserId: string): Promise<void> {
		const [target] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, targetId)).limit(1);
		if (!target) throw new PlatformUserNotFoundError();
		if (target.isAdmin && (await this.adminCount()) <= 1) throw new PlatformLastAdminError();
		if (targetId === actingUserId) throw new PlatformSelfDeleteError();

		await db.delete(users).where(eq(users.id, targetId));
	}

	private async adminCount(): Promise<number> {
		const [row] = await db.select({ value: count() }).from(users).where(eq(users.isAdmin, true));
		return row?.value ?? 0;
	}
}
