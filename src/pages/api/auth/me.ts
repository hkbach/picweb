import type { APIRoute } from 'astro';
import { userFromRequest } from '../../../server/sessions.ts';
import { json } from '../../../server/admin-api.ts';
import { toPublic } from '../../../server/accounts.ts';

export const prerender = false;

// Tells the pages (which are built ahead of time) who is signed in.
export const GET: APIRoute = async ({ request }) => {
	const user = userFromRequest(request);
	return json({ user: user ? toPublic(user) : null });
};
