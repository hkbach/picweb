import type { APIRoute } from 'astro';
import { downloadImage, DownloadError } from '../../../../crawler/download-image.ts';
import { MAX_PHOTOS_IN_FOLDER, PHOTOS_DIR, adminApiEnabled, json, rejectUnlessSameOriginJson, requireAdmin } from '../../../server/admin-api.ts';

// Downloads ONE image per request, so the page can show progress and carry on after a failure.
export const prerender = false;

// A few at once is fine (the page sends three); more than that is refused rather than queued.
const MAX_AT_ONCE = 4;
let running = 0;

export const POST: APIRoute = async ({ request }) => {
	if (!adminApiEnabled) return json({ error: 'Downloading is disabled on this server.' }, 403);
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	let url = '';
	try {
		const body = await request.json();
		url = typeof body?.url === 'string' ? body.url : '';
	} catch {
		return json({ error: 'Invalid request.' }, 400);
	}
	if (!url) return json({ error: 'Send the image address as "url".' }, 400);

	if (running >= MAX_AT_ONCE) return json({ error: 'Too many downloads at once. Try again in a moment.' }, 429);
	running++;
	try {
		const saved = await downloadImage(url, { dir: PHOTOS_DIR, maxFiles: MAX_PHOTOS_IN_FOLDER });
		return json({ name: saved.name, url: `/api/admin/photos/${saved.name}`, bytes: saved.bytes, type: saved.type, existed: saved.existed });
	} catch (error) {
		// Only our own, admin-safe messages are passed on; anything unexpected stays generic.
		const message = error instanceof DownloadError ? error.message : 'The image could not be downloaded.';
		return json({ error: message }, 502);
	} finally {
		running--;
	}
};
