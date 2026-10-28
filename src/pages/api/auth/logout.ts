import type { APIRoute } from 'astro';
import { clearedSessionCookie, destroySession } from '../../../server/sessions.ts';
import { json, rejectCrossSite } from '../../../server/admin-api.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;
	destroySession(request); // the session is ended on the server, not only forgotten by the browser
	const response = json({ ok: true });
	response.headers.append('set-cookie', clearedSessionCookie());
	return response;
};
