import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { db, transaction } from '../../../../server/db.ts';
import { audit } from '../../../../server/audit.ts';
import { hashPassword, passwordProblem } from '../../../../server/passwords.ts';
import { destroyUserSessions } from '../../../../server/sessions.ts';
import { cleanEmail, cleanName, readJson } from '../../../../server/validate.ts';
import { json, rejectCrossOrigin, requireAdmin } from '../../../../server/admin-api.ts';

export const prerender = false;

const MAX_CHANGES = 500;
const ID = /^[A-Za-z0-9-]{1,64}$/;

class Refused extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}

interface Row {
	id: string;
	role: 'user' | 'admin';
	status: string;
}

const validStatus = (value: unknown) => value === 'active' || value === 'deactivated';

// Applies everything an administrator staged on the Users page as ONE unit: if any part is refused,
// nothing is changed.
export const POST: APIRoute = async ({ request }) => {
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;

	const body = await readJson(request, 1024 * 1024);
	if (!body) return json({ error: 'Invalid request.' }, 400);
	for (const key of ['created', 'updated', 'deleted', 'passwordResets']) {
		const value = body[key];
		if (!Array.isArray(value) || value.length > MAX_CHANGES) return json({ error: 'Invalid request.' }, 400);
	}
	const created = body.created as any[];
	const updated = body.updated as any[];
	const deleted = body.deleted as any[];
	const passwordResets = body.passwordResets as any[];

	// Passwords are hashed before the database is touched (hashing is slow and must not hold the write lock).
	const hashed = new Map<string, { hash: string; mustChange: boolean }>();
	try {
		for (const reset of passwordResets) {
			if (!reset || typeof reset.id !== 'string' || !ID.test(reset.id)) throw new Refused('Invalid password change.');
			const problem = passwordProblem(reset.password);
			if (problem) throw new Refused(problem);
			hashed.set(reset.id, { hash: await hashPassword(reset.password), mustChange: reset.mustChangeAtNextSignIn === true });
		}
	} catch (error) {
		if (error instanceof Refused) return json({ error: error.message }, error.status);
		throw error;
	}

	try {
		const ids = transaction(() => {
			const map: Record<string, string> = {};
			const find = db().prepare('SELECT id, role, status FROM users WHERE id = ?');
			const adminsLeft = () => (db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get() as { n: number }).n;

			for (const user of deleted) {
				if (typeof user !== 'string' || !ID.test(user)) throw new Refused('Invalid request.');
				if (user === admin.id) throw new Refused('You cannot delete your own account.');
				const row = find.get(user) as Row | undefined;
				if (!row) continue; // already gone
				db().prepare('DELETE FROM users WHERE id = ?').run(user);
				if (row.role === 'admin' && adminsLeft() === 0) throw new Refused('The last administrator cannot be deleted.');
				audit(admin.id, 'user.delete', user);
			}

			for (const u of updated) {
				const firstName = cleanName(u?.firstName);
				const lastName = cleanName(u?.lastName);
				const email = cleanEmail(u?.email);
				if (typeof u?.id !== 'string' || !ID.test(u.id) || !firstName || !lastName || !email || !validStatus(u.status)) throw new Refused('A user has invalid details.');
				const row = find.get(u.id) as Row | undefined;
				if (!row) throw new Refused('A user you changed no longer exists. Reload the page.', 409);
				if (u.status === 'deactivated' && u.id === admin.id) throw new Refused('You cannot deactivate your own account.');
				const before = db().prepare('SELECT first_name, last_name, email, status FROM users WHERE id = ?').get(u.id) as { first_name: string; last_name: string; email: string; status: string };
				db().prepare('UPDATE users SET first_name = ?, last_name = ?, email = ?, status = ? WHERE id = ?').run(firstName, lastName, email, u.status, u.id);
				// A deactivated user is signed out everywhere straight away.
				if (u.status === 'deactivated') destroyUserSessions(u.id);
				if (row.role === 'admin' && u.status === 'deactivated' && adminsLeft() === 0) throw new Refused('The last administrator cannot be deactivated.');
				const fields = [before.first_name !== firstName && 'firstName', before.last_name !== lastName && 'lastName', before.email.toLowerCase() !== email && 'email', before.status !== u.status && 'status'].filter(Boolean);
				if (fields.length > 0) audit(admin.id, 'user.update', u.id, fields.join(','));
			}

			for (const u of created) {
				const firstName = cleanName(u?.firstName);
				const lastName = cleanName(u?.lastName);
				const email = cleanEmail(u?.email);
				if (typeof u?.id !== 'string' || !ID.test(u.id) || !firstName || !lastName || !email || !validStatus(u.status)) throw new Refused('A new user has invalid details.');
				const id = randomUUID();
				// "!" is not a valid hash, so nobody can sign in until a password is set (see passwordResets).
				db()
					.prepare("INSERT INTO users (id, first_name, last_name, email, password_hash, role, status, must_change_password, created_at) VALUES (?, ?, ?, ?, '!', 'user', ?, 0, ?)")
					.run(id, firstName, lastName, email, u.status, new Date().toISOString());
				map[u.id] = id;
				audit(admin.id, 'user.create', id);
			}

			for (const [staged, reset] of hashed) {
				const id = map[staged] ?? staged;
				if (deleted.includes(id)) continue;
				const result = db().prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(reset.hash, reset.mustChange ? 1 : 0, id);
				if (result.changes === 0) throw new Refused('A user whose password you changed no longer exists. Reload the page.', 409);
				// The old password must stop working everywhere; for the administrator's own account this session is kept.
				destroyUserSessions(id, id === admin.id ? request : undefined);
				audit(admin.id, 'user.password-reset', id, reset.mustChange ? 'must-change' : undefined);
			}
			return map;
		});
		return json({ ok: true, ids });
	} catch (error) {
		if (error instanceof Refused) return json({ error: error.message }, error.status);
		if (String((error as Error).message).includes('UNIQUE')) return json({ error: 'Another user already has one of these email addresses.' }, 409);
		throw error;
	}
};
