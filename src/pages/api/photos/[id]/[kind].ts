import type { APIRoute } from 'astro';
import { db } from '../../../../server/db.ts';
import { json, rejectCrossSite, requireUser } from '../../../../server/admin-api.ts';

export const prerender = false;

// PUT adds a photo to the signed-in user's likes or favorites, DELETE takes it out. Both are safe to repeat:
// the result is the same however many times a request arrives. The user always comes from the session.
const TABLES: Record<string, 'likes' | 'favorites'> = { like: 'likes', favorite: 'favorites' };

const handle: APIRoute = async ({ params, request }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;
	const user = requireUser(request);
	if (user instanceof Response) return user;

	const table = TABLES[params.kind ?? ''];
	const photoId = Number(params.id);
	if (!table || !Number.isInteger(photoId)) return json({ error: 'Not found.' }, 404);
	if (!db().prepare('SELECT 1 FROM photos WHERE id = ?').get(photoId)) return json({ error: 'Photo not found.' }, 404);

	if (request.method === 'PUT') {
		db().prepare(`INSERT OR IGNORE INTO ${table} (user_id, photo_id, created_at) VALUES (?, ?, ?)`).run(user.id, photoId, new Date().toISOString());
	} else {
		db().prepare(`DELETE FROM ${table} WHERE user_id = ? AND photo_id = ?`).run(user.id, photoId);
	}
	return json({ ok: true, on: request.method === 'PUT' });
};

export const PUT = handle;
export const DELETE = handle;
