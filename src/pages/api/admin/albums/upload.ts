import type { APIRoute } from 'astro';
import { transaction } from '../../../../server/db.ts';
import { AlbumError, cleanCategoryIds, cleanTitle, insertAlbum, removeUnreferenced } from '../../../../server/albums.ts';
import { readUploadRequest, storeItems } from '../../../../server/uploads.ts';
import { getStorage } from '../../../../server/storage.ts';
import { json, rejectCrossOrigin, requireAdmin } from '../../../../server/admin-api.ts';

// Creates an album from the Upload tab. The page deletes its downloaded copies right after a 200, so a 200 means
// the album AND every photo are stored; on any other answer nothing was created and the page keeps its copies.
//  - Nothing is stored until a storage driver is configured (see src/server/storage.ts): without one this
//    answers 501 and the page says so.
//  - The multipart request is read in full and every file is checked by its content before anything is stored.
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const storage = getStorage();
	if (!storage) return json({ error: 'Photo storage is not configured on this server.' }, 501);

	let keys: string[] = [];
	try {
		const { meta, items } = await readUploadRequest(request);
		if (meta.type !== 'uploaded') throw new AlbumError('Invalid request.');
		const title = cleanTitle(meta.title);
		const categoryIds = cleanCategoryIds(meta.categoryIds);
		const coverIndex = Number.isInteger(meta.coverIndex) ? meta.coverIndex : -1;
		if (items.some((i) => i.existingUrl)) throw new AlbumError('Invalid request.');

		keys = items.map((i) => i.key!);
		const urls = await storeItems(storage, items);
		const photos = items.map((i) => ({ url: urls.get(i.key!)!, alt: i.alt, width: i.width, height: i.height, storageKey: i.key! }));
		const id = transaction(() => insertAlbum(admin.id, { title, type: 'uploaded', categoryIds, coverIndex, photos }));
		return json({ ok: true, id }, 201);
	} catch (error) {
		// Pictures stored for an album that was not created are removed again (unless another album uses them).
		await removeUnreferenced(keys);
		if (error instanceof AlbumError) return json({ error: error.message }, error.status);
		throw error;
	}
};
