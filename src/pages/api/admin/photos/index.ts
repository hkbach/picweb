import type { APIRoute } from 'astro';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { MAX_PHOTOS_IN_FOLDER, PHOTOS_DIR, PHOTOS_FOLDER_NAME, SAVED_NAME, adminApiEnabled, json, rejectUntrustedHost } from '../../../../server/admin-api.ts';

// Lists what is stored in the downloaded-photos folder. Read-only: deleting goes through the
// per-photo DELETE in [name].ts, so a delete always names exactly the files it means.
export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	if (!adminApiEnabled) return json({ error: 'This is disabled on this server.' }, 403);
	const untrusted = rejectUntrustedHost(request);
	if (untrusted) return untrusted;

	let entries: string[] = [];
	try {
		entries = await readdir(PHOTOS_DIR);
	} catch (error) {
		// No folder yet simply means nothing has been downloaded.
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return json({ error: 'The folder could not be read.' }, 500);
	}

	const photos = [];
	let others = 0;
	for (const name of entries) {
		if (name.startsWith('.')) continue; // .gitkeep and the like are not photos and not worth mentioning
		if (!SAVED_NAME.test(name)) {
			others++; // something this site did not put here; it is counted, never listed or touched
			continue;
		}
		try {
			const info = await stat(path.join(PHOTOS_DIR, name));
			if (!info.isFile()) continue;
			photos.push({ name, bytes: info.size, type: name.split('.').pop()!, modified: info.mtime.toISOString() });
		} catch {
			// removed between the listing and the stat: skip it
		}
	}
	photos.sort((a, b) => b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name)); // newest first

	return json({ folder: PHOTOS_FOLDER_NAME, maxFiles: MAX_PHOTOS_IN_FOLDER, others, photos });
};
