import type { APIRoute } from 'astro';
import { db } from '../../../server/db.ts';
import { hashPassword, passwordProblem } from '../../../server/passwords.ts';
import { destroyUserSessions } from '../../../server/sessions.ts';
import { readJson } from '../../../server/validate.ts';
import { json, rejectCrossSite, requireUser } from '../../../server/admin-api.ts';

export const prerender = false;

// The Profile page asks only for the new password (the current-password field was removed on request), so
// whoever holds the session can change it. Every OTHER session of the account is ended, so a stolen
// session does not survive the change.
export const POST: APIRoute = async ({ request }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;
	const user = requireUser(request);
	if (user instanceof Response) return user;

	const body = await readJson(request);
	const problem = passwordProblem(body?.password);
	if (!body || problem) return json({ error: problem ?? 'Invalid request.' }, 400);

	const passwordHash = await hashPassword(body.password as string);
	db().prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, user.id);
	destroyUserSessions(user.id, request);
	return json({ ok: true });
};
