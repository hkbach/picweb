import type { APIRoute } from 'astro';
import { listCloudPhotos } from '../../../../server/cloud-photos.ts';
import { getStorage, R2_READ_MESSAGE, StorageError } from '../../../../server/storage.ts';
import { json, rejectCrossOrigin, requireAdmin } from '../../../../server/admin-api.ts';

export const prerender = false;

// The pictures in the photo storage (Cloudflare R2), newest first, with where each one is used. Read-only.
export const GET: APIRoute = async ({ request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectCrossOrigin(request);
	if (rejected) return rejected;

	const storage = getStorage();
	if (!storage) return json({ error: 'Photo storage is not set up on this server (see the Cloudflare guide), so there is nothing to show.' }, 501);
	try {
		const listing = await listCloudPhotos(storage);
		listing.photos.sort((a, b) => b.modified.localeCompare(a.modified) || a.key.localeCompare(b.key));
		return json(listing);
	} catch (error) {
		return json({ error: error instanceof StorageError ? error.message : R2_READ_MESSAGE.other }, 502);
	}
};
