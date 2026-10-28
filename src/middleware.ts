import { defineMiddleware } from 'astro:middleware';
import { userFromRequest } from './server/sessions.ts';

// Runs for pages and endpoints that are rendered on demand (the admin and account pages, and /api).
// Pages built ahead of time are plain files and never reach this code, which is why the data an admin
// or account page shows is rendered here, on the server, and not baked into the build.
export const onRequest = defineMiddleware(async ({ request, locals, url, redirect }, next) => {
	const user = userFromRequest(request);
	locals.user = user;

	const path = url.pathname;
	const needsAdmin = path === '/admin' || path.startsWith('/admin/');
	const guarded = needsAdmin || path === '/account' || path.startsWith('/account/');
	if (guarded) {
		if (!user) return redirect(`/?login=required&next=${encodeURIComponent(path + url.search)}`, 302);
		if (needsAdmin && user.role !== 'admin') return new Response('Administrators only.', { status: 403, headers: { 'cache-control': 'no-store' } });
	}

	const response = await next();
	// A page that depends on who is signed in must never be stored by a shared cache.
	if (guarded && !response.headers.has('cache-control')) response.headers.set('cache-control', 'private, no-store');
	return response;
});
