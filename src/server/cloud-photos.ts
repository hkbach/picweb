import { db, transaction } from './db.ts';
import { audit } from './audit.ts';
import { MEDIA_KEY, R2_READ_MESSAGE, r2ErrorKind, type PhotoStorage } from './storage.ts';

// The pictures in the photo storage (Cloudflare R2), as the "Cloud photos" admin page shows and deletes them.
// What the storage knows is the name, size and time of each picture; the sizes in pixels and the albums that use a
// picture come from the database.

export interface CloudPhoto {
	key: string;
	url: string;
	bytes: number;
	/** When it was stored (ISO). */
	modified: string;
	/** Size in pixels as saved with the album photo, or 0 when no album uses it (the page measures it itself). */
	width: number;
	height: number;
	albums: Array<{ id: number; title: string }>;
}

export interface CloudListing {
	photos: CloudPhoto[];
	/** Objects in the bucket that this site did not put there: not listed, never touched. */
	others: number;
	truncated: boolean;
	totalBytes: number;
}

export async function listCloudPhotos(storage: PhotoStorage): Promise<CloudListing> {
	const { objects, others, truncated } = await storage.list();
	const rows = db()
		.prepare('SELECT p.storage_key AS key, p.width, p.height, a.id AS album_id, a.title FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.storage_key IS NOT NULL ORDER BY a.id')
		.all() as unknown as Array<{ key: string; width: number; height: number; album_id: number; title: string }>;
	const used = new Map<string, { width: number; height: number; albums: Map<number, string> }>();
	for (const r of rows) {
		const entry = used.get(r.key) ?? { width: 0, height: 0, albums: new Map<number, string>() };
		if (entry.width === 0 && r.width > 0) {
			entry.width = r.width;
			entry.height = r.height;
		}
		entry.albums.set(r.album_id, r.title);
		used.set(r.key, entry);
	}
	const photos = objects.map((o) => {
		const entry = used.get(o.key);
		return {
			key: o.key,
			url: storage.publicUrl(o.key),
			bytes: o.bytes,
			modified: o.modified,
			width: entry?.width ?? 0,
			height: entry?.height ?? 0,
			albums: [...(entry?.albums ?? [])].map(([id, title]) => ({ id, title })),
		};
	});
	return { photos, others, truncated, totalBytes: photos.reduce((sum, p) => sum + p.bytes, 0) };
}

export interface DeleteOutcome {
	key: string;
	/** deleted: gone from the storage and from every album; failed: the storage did not delete it, nothing else changed;
	 *  kept: not even tried, because it is the only photo of an album. */
	status: 'deleted' | 'failed' | 'kept';
	reason?: string;
	/** For a deleted picture: how many albums it was taken out of. */
	albums?: number;
}

export const MAX_DELETE_KEYS = 100;

/** The albums that would be left with no photo if every photo using `key` were removed. */
const albumsLeftEmpty = (key: string) =>
	db()
		.prepare(
			`SELECT a.id, a.title FROM albums a
			 WHERE EXISTS (SELECT 1 FROM photos p WHERE p.album_id = a.id AND p.storage_key = ?)
			   AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.album_id = a.id AND (p.storage_key IS NULL OR p.storage_key <> ?))`,
		)
		.all(key, key) as unknown as Array<{ id: number; title: string }>;

/**
 * Deletes pictures from the storage FIRST and only then from the albums that use them, one picture at a time:
 *  - if the storage does not delete it, the album photo is left alone and the picture is reported as failed;
 *  - a picture that is the only photo of an album is kept (an album with no photo cannot be shown); the rest of the
 *    batch carries on, and the state is checked again for each picture, so a batch never empties an album.
 * Likes and favorites of a removed album photo go with it. A cover that is removed is replaced by the album's first photo.
 */
export async function deleteCloudPhotos(actorId: string, storage: PhotoStorage, keys: string[]): Promise<DeleteOutcome[]> {
	const outcomes: DeleteOutcome[] = [];
	for (const key of new Set(keys)) {
		if (!MEDIA_KEY.test(key)) {
			outcomes.push({ key, status: 'failed', reason: 'This is not a picture name this site gave, so it is not touched.' });
			continue;
		}
		const empty = albumsLeftEmpty(key);
		if (empty.length > 0) {
			const names = empty.slice(0, 2).map((a) => `“${a.title}”`).join(', ') + (empty.length > 2 ? ` and ${empty.length - 2} more` : '');
			outcomes.push({ key, status: 'kept', reason: `It is the only photo of ${empty.length === 1 ? 'the album' : 'the albums'} ${names}, so it was kept. Edit or delete ${empty.length === 1 ? 'that album' : 'those albums'} first.` });
			continue;
		}
		try {
			await storage.remove(key);
		} catch (error) {
			outcomes.push({ key, status: 'failed', reason: `Cloudflare did not delete it, so it is still in its albums. ${R2_READ_MESSAGE[r2ErrorKind(error)]}` });
			continue;
		}
		// The storage no longer has it: take it out of the albums, all at once.
		const albums = transaction(() => {
			const holders = db().prepare('SELECT DISTINCT album_id FROM photos WHERE storage_key = ?').all(key) as unknown as Array<{ album_id: number }>;
			db().prepare('DELETE FROM photos WHERE storage_key = ?').run(key);
			for (const { album_id } of holders) {
				const cover = db().prepare('SELECT 1 FROM photos p JOIN albums a ON a.cover_photo_id = p.id WHERE a.id = ?').get(album_id);
				if (!cover) db().prepare('UPDATE albums SET cover_photo_id = (SELECT id FROM photos WHERE album_id = ? ORDER BY position, id LIMIT 1) WHERE id = ?').run(album_id, album_id);
			}
			audit(actorId, 'storage.delete', key, `${holders.length} albums`);
			return holders.length;
		});
		outcomes.push({ key, status: 'deleted', albums });
	}
	return outcomes;
}
