import type { APIRoute } from 'astro';
import { db } from '../../../server/db.ts';
import { verifyAgainstDecoy, verifyPassword } from '../../../server/passwords.ts';
import { createSession, sessionCookie } from '../../../server/sessions.ts';
import { allow, forget } from '../../../server/limits.ts';
import { cleanEmail, readJson } from '../../../server/validate.ts';
import { json, rejectCrossSite } from '../../../server/admin-api.ts';
import { toPublic } from '../../../server/accounts.ts';

export const prerender = false;

const WINDOW = 15 * 60 * 1000;
// One message for every failure, so the answer never tells whether an email has an account.
const FAILED = 'The email or password is not correct.';

interface Row {
	id: string;
	first_name: string;
	last_name: string;
	email: string;
	role: 'user' | 'admin';
	status: string;
	must_change_password: number;
	avatar: string | null;
	password_hash: string;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;

	const body = await readJson(request);
	const email = cleanEmail(body?.email);
	const password = typeof body?.password === 'string' ? body.password : '';
	if (!email || !password || password.length > 128) return json({ error: FAILED }, 401);

	// Two counters: many tries from one address, and many tries against one account from anywhere.
	if (!allow(`login-ip:${clientAddress}`, 30, WINDOW) || !allow(`login-email:${email}`, 8, WINDOW)) {
		return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
	}

	const row = db()
		.prepare('SELECT id, first_name, last_name, email, role, status, must_change_password, avatar, password_hash FROM users WHERE email = ?')
		.get(email) as Row | undefined;

	if (!row) {
		await verifyAgainstDecoy(password);
		return json({ error: FAILED }, 401);
	}
	const correct = await verifyPassword(password, row.password_hash);
	// A deactivated account is refused with the same message as a wrong password.
	if (!correct || row.status !== 'active') return json({ error: FAILED }, 401);

	forget(`login-email:${email}`);
	const { token, expires } = createSession(row.id);
	const response = json({
		user: toPublic({
			id: row.id,
			firstName: row.first_name,
			lastName: row.last_name,
			email: row.email,
			role: row.role,
			mustChangePassword: row.must_change_password === 1,
			avatar: row.avatar,
		}),
	});
	response.headers.append('set-cookie', sessionCookie(token, expires));
	return response;
};
