import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.ts';

// Signed-in state is a random token in an HttpOnly cookie. The server keeps only the token's SHA-256,
// so reading the database does not reveal a usable token. Deactivated users never validate.
export const SESSION_COOKIE = 'picweb_session';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionUser {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	role: 'user' | 'admin';
	mustChangePassword: boolean;
	avatar: string | null;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(userId: string): { token: string; expires: Date } {
	const token = randomBytes(32).toString('base64url');
	const now = new Date();
	const expires = new Date(now.getTime() + TTL_MS);
	// Old rows are removed here, on sign-in, so no separate cleanup job is needed.
	db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
	db().prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hash(token), userId, now.toISOString(), expires.toISOString());
	return { token, expires };
}

export function sessionCookie(token: string, expires: Date): string {
	// Secure outside `astro dev` (browsers still accept it on http://localhost).
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${import.meta.env.PROD ? '; Secure' : ''}`;
}

export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${import.meta.env.PROD ? '; Secure' : ''}`;

export function tokenFrom(request: Request): string | null {
	const header = request.headers.get('cookie');
	if (!header) return null;
	for (const part of header.split(';')) {
		const [name, ...value] = part.trim().split('=');
		if (name === SESSION_COOKIE) return value.join('=') || null;
	}
	return null;
}

export function userFromRequest(request: Request): SessionUser | null {
	const token = tokenFrom(request);
	if (!token) return null;
	const row = db()
		.prepare(
			`SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.must_change_password, u.avatar
			 FROM sessions s JOIN users u ON u.id = s.user_id
			 WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
		)
		.get(hash(token), new Date().toISOString()) as
		| { id: string; first_name: string; last_name: string; email: string; role: 'user' | 'admin'; must_change_password: number; avatar: string | null }
		| undefined;
	if (!row) return null;
	return { id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, role: row.role, mustChangePassword: row.must_change_password === 1, avatar: row.avatar };
}

export function destroySession(request: Request) {
	const token = tokenFrom(request);
	if (token) db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}

/** Ends every session of a user, except the one making this request when `keep` is given. */
export function destroyUserSessions(userId: string, keep?: Request) {
	const token = keep ? tokenFrom(keep) : null;
	if (token) db().prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hash(token));
	else db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
