import type { APIRoute } from 'astro';
import { db, transaction } from '../../../../server/db.ts';
import { AlbumError, cleanCategoryIds, cleanPhotoMeta, cleanRemoteUrl, cleanTitle, parsePhotoCount, replaceAlbum } from '../../../../server/albums.ts';
import { readJson } from '../../../../server/validate.ts';
import { json, rejectUnlessSameOriginJson, requireAdmin } from '../../../../server/admin-api.ts';

export const prerender = false;

// Changes an album made from image links. The album keeps its original type.
export const PUT: APIRoute = async ({ params, request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	const id = Number(params.id);
	const album = Number.isInteger(id) ? (db().prepare('SELECT id, type FROM albums WHERE id = ?').get(id) as { id: number; type: string } | undefined) : undefined;
	if (!album) return json({ error: 'Album not found.' }, 404);
	if (album.type !== 'crawling') return json({ error: 'This album was made from uploaded files.' }, 400);

	const body = await readJson(request, 1024 * 1024);
	if (!body) return json({ error: 'Invalid request.' }, 400);
	try {
		const title = cleanTitle(body.title);
		const categoryIds = cleanCategoryIds(body.categoryIds);
		const photos = parsePhotoCount(body.photos).map((p) => ({ url: cleanRemoteUrl(p?.url), ...cleanPhotoMeta(p), storageKey: null }));
		const coverIndex = photos.findIndex((p) => p.url === cleanRemoteUrl(body.coverUrl));
		if (coverIndex < 0) throw new AlbumError('Choose which photo is the cover.');
		transaction(() => replaceAlbum(admin.id, id, { title, categoryIds, coverIndex, photos }));
		return json({ ok: true });
	} catch (error) {
		if (error instanceof AlbumError) return json({ error: error.message }, error.status);
		throw error;
	}
};
