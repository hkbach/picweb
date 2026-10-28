import type { APIRoute } from 'astro';
import { transaction } from '../../../../server/db.ts';
import { AlbumError, cleanCategoryIds, cleanPhotoMeta, cleanRemoteUrl, cleanSources, cleanTitle, insertAlbum, parsePhotoCount } from '../../../../server/albums.ts';
import { readJson } from '../../../../server/validate.ts';
import { json, rejectUnlessSameOriginJson, requireAdmin } from '../../../../server/admin-api.ts';

export const prerender = false;

// Creates an album made from image links (the "From URLs" tab). The server stores the addresses only; it never
// fetches them, so a link cannot make the server reach an internal address.
export const POST: APIRoute = async ({ request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	const body = await readJson(request, 1024 * 1024);
	if (!body) return json({ error: 'Invalid request.' }, 400);
	try {
		if (body.type !== 'crawling') throw new AlbumError('Invalid request.');
		const title = cleanTitle(body.title);
		const categoryIds = cleanCategoryIds(body.categoryIds);
		const list = parsePhotoCount(body.photos);
		const photos = list.map((p) => ({ url: cleanRemoteUrl(p?.url), ...cleanPhotoMeta(p), storageKey: null }));
		const coverIndex = photos.findIndex((p) => p.url === cleanRemoteUrl(body.coverUrl));
		if (coverIndex < 0) throw new AlbumError('Choose which photo is the cover.');
		const sources = cleanSources(body.sources);
		const id = transaction(() => insertAlbum(admin.id, { title, type: 'crawling', categoryIds, coverIndex, photos, sources }));
		return json({ ok: true, id }, 201);
	} catch (error) {
		if (error instanceof AlbumError) return json({ error: error.message }, error.status);
		throw error;
	}
};
