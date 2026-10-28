import type { APIRoute } from 'astro';
import { db } from '../../../../server/db.ts';
import { allow } from '../../../../server/limits.ts';
import { userFromRequest } from '../../../../server/sessions.ts';
import { recordAlbumOpen } from '../../../../server/credits.ts';
import { json, rejectCrossSite } from '../../../../server/admin-api.ts';

export const prerender = false;

// Counts one view of a photo (the album popup showed it). Open to visitors who are not signed in, so it is limited:
// only photos a visitor can see are counted, and one address may report a bounded number per minute. The page also
// reports each photo once per tab session. It is a popularity figure, not a security record: a script could still
// inflate it within the limit, and nothing about the visitor is stored.
const PER_MINUTE = 120;

export const POST: APIRoute = async ({ params, request, clientAddress }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;

	const photoId = Number(params.id);
	if (!Number.isInteger(photoId)) return json({ error: 'Not found.' }, 404);
	if (!allow(`view:${clientAddress}`, PER_MINUTE, 60_000)) return json({ error: 'Too many requests.' }, 429);
	const photo = db().prepare("SELECT p.album_id FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.id = ? AND a.status = 'active'").get(photoId) as { album_id: number } | undefined;
	if (!photo) return json({ error: 'Not found.' }, 404);

	db().prepare('INSERT INTO photo_views (photo_id, views) VALUES (?, 1) ON CONFLICT(photo_id) DO UPDATE SET views = views + 1').run(photoId);
	// A signed-in user who was invited through a link: this album counts towards a credit for the person who invited them.
	const user = userFromRequest(request);
	if (user) recordAlbumOpen(user.id, photo.album_id);
	return json({ ok: true });
};
