import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { db, transaction } from '../../../server/db.ts';
import { findInviter, newReferralCode, registerCredits } from '../../../server/credits.ts';
import { hashPassword, passwordProblem } from '../../../server/passwords.ts';
import { createSession, sessionCookie } from '../../../server/sessions.ts';
import { allow } from '../../../server/limits.ts';
import { cleanEmail, cleanName, readJson } from '../../../server/validate.ts';
import { json, rejectCrossSite } from '../../../server/admin-api.ts';
import { toPublic } from '../../../server/accounts.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;
	if (!allow(`register:${clientAddress}`, 10, 60 * 60 * 1000)) return json({ error: 'Too many sign-ups from this address. Try again later.' }, 429);

	const body = await readJson(request);
	if (!body) return json({ error: 'Invalid request.' }, 400);
	const firstName = cleanName(body.firstName);
	const lastName = cleanName(body.lastName);
	const email = cleanEmail(body.email);
	if (!firstName || !lastName) return json({ error: 'Enter your first and last name.' }, 400);
	if (!email) return json({ error: 'Enter a valid email address.' }, 400);
	const problem = passwordProblem(body.password);
	if (problem) return json({ error: problem }, 400);

	const id = randomUUID();
	const passwordHash = await hashPassword(body.password as string);
	try {
		// New accounts are always plain users; an administrator is only ever made by the bootstrap or by another administrator.
		// A code that matches nobody is ignored: it must never stop a sign-up.
		const inviterId = typeof body.ref === 'string' ? findInviter(body.ref) : null;
		transaction(() => {
			db()
				.prepare("INSERT INTO users (id, first_name, last_name, email, password_hash, role, created_at, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?)")
				.run(id, firstName, lastName, email, passwordHash, new Date().toISOString(), newReferralCode(), inviterId);
			registerCredits(id, inviterId);
		});
	} catch (error) {
		if (String((error as Error).message).includes('UNIQUE')) return json({ error: 'An account with this email already exists.' }, 409);
		throw error;
	}

	const { token, expires } = createSession(id);
	const response = json({ user: toPublic({ id, firstName, lastName, email, role: 'user', mustChangePassword: false, avatar: null }) }, 201);
	response.headers.append('set-cookie', sessionCookie(token, expires));
	return response;
};
