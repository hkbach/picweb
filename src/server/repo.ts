import { db } from './db.ts';

// Reads used by the pages that are rendered on the server.

export interface Category {
	id: string;
	name: string;
}

export function listCategories(): Category[] {
	return db().prepare('SELECT id, name FROM categories ORDER BY position').all() as unknown as Category[];
}

export interface UserRow {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	status: 'active' | 'deactivated';
	/** Registration day as YYYY-MM-DD (UTC). */
	registeredAt: string;
}

export function listUsers(): UserRow[] {
	const rows = db().prepare('SELECT id, first_name, last_name, email, status, created_at FROM users ORDER BY created_at').all() as Array<{
		id: string;
		first_name: string;
		last_name: string;
		email: string;
		status: 'active' | 'deactivated';
		created_at: string;
	}>;
	return rows.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, status: r.status, registeredAt: r.created_at.slice(0, 10) }));
}
