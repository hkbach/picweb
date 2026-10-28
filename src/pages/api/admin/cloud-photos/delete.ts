import type { APIRoute } from 'astro';
import { deleteCloudPhotos, MAX_DELETE_KEYS } from '../../../../server/cloud-photos.ts';
import { getStorage } from '../../../../server/storage.ts';
import { readJson } from '../../../../server/validate.ts';
import { json, rejectUnlessSameOriginJson, requireAdmin } from '../../../../server/admin-api.ts';

export const prerender = false;

// Deletes the named pictures from the photo storage and, for each one the storage really deleted, from the albums that
// use it (see deleteCloudPhotos). Only the names sent are touched: there is no "delete everything" request.
export const POST: APIRoute = async ({ request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	const body = await readJson(request, 64 * 1024);
	const keys: unknown = body?.keys;
	if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === 'string' && k.length <= 100)) return json({ error: 'Send the names of the pictures to delete.' }, 400);
	if (keys.length > MAX_DELETE_KEYS) return json({ error: `At most ${MAX_DELETE_KEYS} pictures can be deleted in one request.` }, 400);

	const storage = getStorage();
	if (!storage) return json({ error: 'Photo storage is not set up on this server, so nothing can be deleted.' }, 501);
	return json({ results: await deleteCloudPhotos(admin.id, storage, keys as string[]) });
};
