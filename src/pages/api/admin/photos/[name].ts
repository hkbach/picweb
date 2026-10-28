import type { APIRoute } from 'astro';
import path from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { PHOTOS_DIR, SAVED_NAME, adminApiEnabled, json, rejectCrossOrigin, requireAdmin } from '../../../../server/admin-api.ts';

// Serves an image saved by the Crawling page's download, so the album form can show it,
// and deletes it again when the admin clears the Create new album page.
export const prerender = false;

export const DELETE: APIRoute = async ({ params, request }) => {
	if (!adminApiEnabled) return json({ error: 'This is disabled on this server.' }, 403);
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;

	// Only names this server generated can be deleted: never .gitkeep, never a path.
	const name = params.name ?? '';
	if (!SAVED_NAME.test(name)) return json({ error: 'Not found.' }, 404);

	try {
		await unlink(path.join(PHOTOS_DIR, name));
	} catch (error) {
		// Already gone counts as success: the goal (the file is not there) is met.
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return json({ error: 'The photo could not be deleted.' }, 500);
	}
	return new Response(null, { status: 204 });
};

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

export const GET: APIRoute = async ({ params, request }) => {
	const name = params.name ?? '';
	// Only names this server generated are opened, so no path can reach outside the folder.
	if (!adminApiEnabled || !SAVED_NAME.test(name)) return new Response('Not found', { status: 404 });
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;

	try {
		const file = await readFile(path.join(PHOTOS_DIR, name));
		return new Response(new Uint8Array(file), {
			headers: {
				'content-type': TYPES[name.split('.').pop()!],
				// Never let a browser guess a different type, and never run anything from this file.
				'x-content-type-options': 'nosniff',
				'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
				'cache-control': 'private, max-age=3600',
			},
		});
	} catch {
		return new Response('Not found', { status: 404 });
	}
};
