import path from 'node:path';
import { userFromRequest, type SessionUser } from './sessions.ts';

// Shared rules for the admin endpoints that run on the server and reach the network or the disk.
// Every one of them also requires an administrator's session (requireAdmin at the end of this file).

/** Off unless running `astro dev` or CRAWL_API_ENABLED=true is set on purpose. */
export const adminApiEnabled = import.meta.env.DEV || process.env.CRAWL_API_ENABLED === 'true';

/** Where images downloaded from the Crawling page are kept. Relative to where the server is started. */
export const PHOTOS_DIR = path.resolve(process.cwd(), 'photos_dowloaded');

export const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});

/**
 * Host names the admin endpoints answer to. Under `astro dev` only this machine's own names; elsewhere the
 * comma-separated ADMIN_ALLOWED_HOSTS list (for example "admin.example.com"), and nothing when it is unset.
 * Without this check a hostile site could point its own domain at this server (DNS rebinding): its page
 * would then be "same origin" and pass the Origin check below.
 */
const allowedHosts = new Set(
	import.meta.env.DEV
		? ['localhost', '127.0.0.1', '[::1]']
		: (process.env.ADMIN_ALLOWED_HOSTS ?? '')
				.split(',')
				.map((h) => h.trim().toLowerCase())
				.filter(Boolean),
);

function hostOf(request: Request): string | null {
	const host = request.headers.get('host');
	if (!host) return null;
	try {
		return new URL(`http://${host}`).hostname;
	} catch {
		return null;
	}
}

/** Refuses a request sent to a host name this server does not answer to. Use on every admin endpoint, GET included. */
export function rejectUntrustedHost(request: Request): Response | null {
	const host = hostOf(request);
	if (!host || !allowedHosts.has(host)) return json({ error: 'This host name is not allowed.' }, 403);
	return null;
}

/** Refuses a request that another website's page made, without looking at the host name (public endpoints). */
export function rejectCrossSite(request: Request): Response | null {
	const origin = request.headers.get('origin');
	if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
	return null;
}

/** Refuses a request that another website's page made: browsers state where a request came from. */
export function rejectCrossOrigin(request: Request): Response | null {
	const untrusted = rejectUntrustedHost(request);
	if (untrusted) return untrusted;
	const origin = request.headers.get('origin');
	if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
	return null;
}

/** Same-origin JSON requests only: this blocks other sites' forms and scripts from calling the API. */
export function rejectUnlessSameOriginJson(request: Request): Response | null {
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	// The media type must be exactly application/json; "text/plain;x=application/json" is a simple
	// request that other sites can send without asking first, so a substring match is not enough.
	const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
	if (mediaType !== 'application/json') return json({ error: 'Send the request as application/json.' }, 415);
	return null;
}

/**
 * Names the server gives saved images; anything else is never opened. Current names are 32 hex characters
 * of the picture's hash (<hash>.jpg). The older <time>-<12 hex>.jpg form is still accepted so photos saved
 * before the change can still be listed, shown and deleted.
 */
export const SAVED_NAME = /^(?:[a-f0-9]{32}|[a-z0-9]+-[a-f0-9]{12})\.(jpg|png|gif|webp)$/;

/** Most images the folder may hold; downloads are refused beyond this so a runaway job cannot fill the disk. */
export const MAX_PHOTOS_IN_FOLDER = 2000;

/** The folder's name as shown to the admin. */
export const PHOTOS_FOLDER_NAME = path.basename(PHOTOS_DIR);

/** The signed-in user, or a 401 response. */
export function requireUser(request: Request): SessionUser | Response {
	return userFromRequest(request) ?? json({ error: 'Sign in first.' }, 401);
}

/** The signed-in administrator, or a 401 / 403 response. Also checks the host name, so use it on every admin endpoint. */
export function requireAdmin(request: Request): SessionUser | Response {
	const untrusted = rejectUntrustedHost(request);
	if (untrusted) return untrusted;
	const user = userFromRequest(request);
	if (!user) return json({ error: 'Sign in first.' }, 401);
	if (user.role !== 'admin') return json({ error: 'Administrators only.' }, 403);
	return user;
}
