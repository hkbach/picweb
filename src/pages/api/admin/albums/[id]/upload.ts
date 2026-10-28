import type { APIRoute } from 'astro';
import { db, transaction } from '../../../../../server/db.ts';
import { AlbumError, cleanCategoryIds, cleanTitle, removeUnreferenced, replaceAlbum } from '../../../../../server/albums.ts';
import { readUploadRequest, storeItems } from '../../../../../server/uploads.ts';
import { getStorage, StorageError } from '../../../../../server/storage.ts';
import { json, rejectCrossOrigin, requireAdmin } from '../../../../../server/admin-api.ts';

// Changes an album made from uploaded files: keeps the photos listed as existing, stores the new ones and
// removes the rest (and their stored pictures). Same rules as creating: answers 501 until storage is configured.
export const prerender = false;

export const PUT: APIRoute = async ({ params, request }) => {
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const storage = getStorage();
	if (!storage) return json({ error: 'Photo storage is not configured on this server.' }, 501);

	const id = Number(params.id);
	const album = Number.isInteger(id) ? (db().prepare('SELECT id, type FROM albums WHERE id = ?').get(id) as { id: number; type: string } | undefined) : undefined;
	if (!album) return json({ error: 'Album not found.' }, 404);
	if (album.type !== 'uploaded') return json({ error: 'This album was made from image links.' }, 400);

	let keys: string[] = [];
	try {
		const { meta, items } = await readUploadRequest(request);
		const title = cleanTitle(meta.title);
		const categoryIds = cleanCategoryIds(meta.categoryIds);
		const coverIndex = Number.isInteger(meta.coverIndex) ? meta.coverIndex : -1;

		// A photo kept as it is must really be one of this album's own.
		const own = new Set((db().prepare('SELECT url FROM photos WHERE album_id = ?').all(id) as Array<{ url: string }>).map((r) => r.url));
		if (items.some((i) => i.existingUrl !== undefined && !own.has(i.existingUrl))) throw new AlbumError('A photo in this album changed. Reload the page.', 409);

		keys = items.flatMap((i) => (i.key ? [i.key] : []));
		const urls = await storeItems(storage, items);
		const photos = items.map((i) =>
			i.existingUrl !== undefined
				? { url: i.existingUrl, alt: i.alt, width: i.width, height: i.height, storageKey: null as string | null }
				: { url: urls.get(i.key!)!, alt: i.alt, width: i.width, height: i.height, storageKey: i.key! },
		);
		const removed = transaction(() => replaceAlbum(admin.id, id, { title, categoryIds, coverIndex, photos }));
		await removeUnreferenced(removed);
		return json({ ok: true });
	} catch (error) {
		await removeUnreferenced(keys);
		if (error instanceof AlbumError) return json({ error: error.message }, error.status);
		if (error instanceof StorageError) return json({ error: error.message }, 502);
		throw error;
	}
};
