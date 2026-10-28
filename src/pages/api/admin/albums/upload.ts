import type { APIRoute } from 'astro';
import { adminApiEnabled, json, rejectCrossOrigin, requireAdmin } from '../../../../server/admin-api.ts';

// The place where the host will be integrated: the Upload tab of Create new album posts a finished album
// here. Until storage exists this answers 501 ("not implemented"), which the page shows as "no album
// service is connected yet" and, importantly, never treats as success.
//
// What the real implementation must do (the page deletes its downloaded copies right after a 200):
//  - read the multipart request: a "meta" JSON part (title, type, categoryIds, coverIndex, photos[]) and one
//    file part per device photo, named by photos[i].part,
//  - for photos[i].storedName, copy the file from photos_dowloaded/ on the server side (the name must match
//    SAVED_NAME in src/server/admin-api.ts; never build a path from anything else),
//  - validate every file by its content, size and count as downloads do (crawler/download-image.ts), and
//    ignore the file names the browser sent,
//  - store the files on the host and create the album as one unit: answer 200 only when the album and ALL of
//    its photos are saved, and nothing is left half-done on an error,
//  - require an authenticated administrator.
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	if (!adminApiEnabled) return json({ error: 'This is disabled on this server.' }, 403);
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	return json({ error: 'Album storage is not connected yet.' }, 501);
};
