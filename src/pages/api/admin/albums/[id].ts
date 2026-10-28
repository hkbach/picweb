import type { APIRoute } from 'astro';
import { db, transaction } from '../../../../server/db.ts';
import { AlbumError, cleanCategoryIds, cleanPhotoMeta, cleanRemoteUrl, cleanTitle, parsePhotoCount, removeUnreferenced, replaceAlbum } from '../../../../server/albums.ts';
import { audit } from '../../../../server/audit.ts';
import { readJson } from '../../../../server/validate.ts';
import { json, rejectCrossOrigin, rejectUnlessSameOriginJson, requireAdmin } from '../../../../server/admin-api.ts';

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

// Deletes an album for good: its photos, categories, crawl history, and every like and favorite of its photos go with
// it, and so do the pictures it kept in the photo storage (Cloudflare R2), except any that another album also uses.
// The album is removed first, then the stored pictures; if some cannot be deleted (Cloudflare unreachable, or no
// storage configured) the answer lists them, so nobody is told it all worked when it did not.
export const DELETE: APIRoute = async ({ params, request }) => {
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;

	const id = Number(params.id);
	const album = Number.isInteger(id) ? (db().prepare('SELECT id FROM albums WHERE id = ?').get(id) as { id: number } | undefined) : undefined;
	if (!album) return json({ error: 'Album not found.' }, 404);

	const rows = db().prepare('SELECT storage_key FROM photos WHERE album_id = ?').all(id) as Array<{ storage_key: string | null }>;
	const keys = rows.flatMap((r) => (r.storage_key ? [r.storage_key] : []));
	transaction(() => {
		db().prepare('DELETE FROM albums WHERE id = ?').run(id); // photos, categories, sources, likes and favorites follow (ON DELETE CASCADE)
		audit(admin.id, 'album.delete', String(id), `${rows.length} photos, ${new Set(keys).size} stored`);
	});

	const report = await removeUnreferenced(keys);
	if (keys.length > 0) audit(admin.id, 'album.delete-storage', String(id), `${report.removed} removed, ${report.kept} kept, ${report.failed.length} not removed`);
	return json({ ok: true, photos: rows.length, stored: new Set(keys).size, removedFromStorage: report.removed, keptInStorage: report.kept, notRemoved: report.failed, storageUnavailable: report.unavailable });
};
