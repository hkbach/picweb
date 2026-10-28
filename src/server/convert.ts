import { createHash } from 'node:crypto';
import { DownloadError, fetchImage } from '../../crawler/download-image.ts';
import { db, transaction } from './db.ts';
import { audit } from './audit.ts';
import { MAX_ALBUM_PHOTOS, removeUnreferenced } from './albums.ts';
import { getStorage, MEDIA_TYPES, StorageError } from './storage.ts';

// Converts an album made from image LINKS (type "crawling") into an album made of UPLOADED pictures: every picture is
// downloaded from where it is, stored in the photo storage (Cloudflare R2), and a NEW album is made that copies the old
// one (title, categories, cover, order, descriptions, sizes, crawl history, creation date, visibility) but points at the
// stored pictures. Only when the copy is complete is the old album deactivated (never deleted).
//
// It is all or nothing: if any picture cannot be downloaded, or the storage refuses one, nothing is created, the old
// album is left as it was and whatever was already stored is removed again. Likes and favorites are not copied (they
// belong to the old photos, which stay with the old album).

export interface ConvertFailure {
	/** The picture's place in the album, counting from 1. */
	position: number;
	reason: string;
}

export type ConvertResult =
	| { ok: true; newAlbumId: number; photos: number; stored: number }
	| { ok: false; status: number; error: string; failed?: ConvertFailure[]; cancelled?: boolean };

export interface ConvertHooks {
	onStart(total: number): void;
	/** Called after each picture is finished (stored, or found to be impossible). */
	onProgress(done: number, total: number): void;
	/** Called once, just before the copy is written to the database. */
	onSaving(): void;
	isCancelled(): boolean;
}

const CONCURRENCY = 3;
/** Pictures each take at most about a minute (the downloader's own limit); this caps the whole conversion. */
const DEADLINE_MS = 15 * 60_000;
const running = new Set<number>();

interface Row {
	id: number;
	position: number;
	url: string;
	alt: string;
	width: number;
	height: number;
}

const fail = (status: number, error: string): ConvertResult => ({ ok: false, status, error });

/** Why a picture could not be fetched, in words that are safe to show. */
const reasonOf = (error: unknown) => (error instanceof DownloadError ? error.message : 'It could not be downloaded.');

const photosOf = (albumId: number) => db().prepare('SELECT id, position, url, alt, width, height FROM photos WHERE album_id = ? ORDER BY position').all(albumId) as unknown as Row[];

/**
 * Checks that the album may be converted and, if so, claims it so nobody else converts it at the same time. The
 * returned `run` must be called (it releases the claim when it finishes).
 */
export function beginConversion(albumId: number): { ok: false; status: number; error: string } | { ok: true; run: (actorId: string, hooks: ConvertHooks) => Promise<ConvertResult> } {
	const album = db().prepare('SELECT id, type, converted_to FROM albums WHERE id = ?').get(albumId) as { id: number; type: string; converted_to: number | null } | undefined;
	if (!album) return { ok: false, status: 404, error: 'Album not found.' };
	if (album.type !== 'crawling') return { ok: false, status: 400, error: 'Only an album made from image links can be converted.' };
	if (album.converted_to !== null) return { ok: false, status: 409, error: 'This album was already converted.' };
	if (running.has(albumId)) return { ok: false, status: 409, error: 'This album is being converted right now.' };
	const storage = getStorage();
	if (!storage) return { ok: false, status: 501, error: 'Photo storage is not configured on this server, so the pictures cannot be uploaded.' };
	if (photosOf(albumId).length === 0) return { ok: false, status: 400, error: 'The album has no photos.' };

	running.add(albumId);
	return {
		ok: true,
		run: async (actorId, hooks) => {
			try {
				return await convert(albumId, actorId, storage, hooks);
			} finally {
				running.delete(albumId);
			}
		},
	};
}

async function convert(albumId: number, actorId: string, storage: NonNullable<ReturnType<typeof getStorage>>, hooks: ConvertHooks): Promise<ConvertResult> {
	const rows = photosOf(albumId);
	if (rows.length > MAX_ALBUM_PHOTOS) return fail(400, `An album holds at most ${MAX_ALBUM_PHOTOS} photos.`);
	const total = rows.length;
	hooks.onStart(total);

	const stored: Array<{ key: string; url: string } | null> = new Array(total).fill(null);
	const failures: ConvertFailure[] = [];
	let storageError: StorageError | null = null;
	let done = 0;
	let next = 0;
	const startedAt = Date.now();

	const worker = async () => {
		for (;;) {
			if (hooks.isCancelled() || storageError) return;
			const i = next++;
			if (i >= total) return;
			if (Date.now() - startedAt > DEADLINE_MS) {
				failures.push({ position: i + 1, reason: 'There was not enough time left.' });
			} else {
				try {
					const { body, type } = await fetchImage(rows[i].url);
					// Once one picture has failed the album will not be made, so the rest are only checked, not stored.
					if (failures.length === 0) {
						const key = `${createHash('sha256').update(body).digest('hex').slice(0, 32)}.${type}`;
						stored[i] = { key, url: await storage.put(key, body, MEDIA_TYPES[type]) };
					}
				} catch (error) {
					if (error instanceof StorageError) storageError = error;
					else failures.push({ position: i + 1, reason: reasonOf(error) });
				}
			}
			done++;
			hooks.onProgress(done, total);
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

	const keys = stored.flatMap((s) => (s ? [s.key] : []));
	const abandon = async (result: ConvertResult) => {
		await removeUnreferenced(keys); // nothing refers to them yet: they are deleted again (unless another album uses the same picture)
		return result;
	};

	if (hooks.isCancelled()) return abandon({ ok: false, status: 499, error: 'The conversion was cancelled. Nothing was changed.', cancelled: true });
	if (storageError) return abandon(fail(502, (storageError as StorageError).message));
	if (failures.length > 0) {
		failures.sort((a, b) => a.position - b.position);
		return abandon({ ok: false, status: 422, error: 'Some pictures could not be downloaded, so nothing was changed.', failed: failures });
	}

	// The album must be exactly what was copied: someone may have edited it while the pictures were being fetched.
	const now = photosOf(albumId);
	if (JSON.stringify(now.map((r) => [r.id, r.url, r.position])) !== JSON.stringify(rows.map((r) => [r.id, r.url, r.position]))) {
		return abandon(fail(409, 'The album was changed while it was being converted. Nothing was changed; try again.'));
	}

	hooks.onSaving();
	try {
		const newAlbumId = transaction(() => {
			const old = db().prepare('SELECT title, status, cover_photo_id, created_at FROM albums WHERE id = ?').get(albumId) as { title: string; status: string; cover_photo_id: number | null; created_at: string };
			// The copy keeps the old album's date (so it keeps its place on the Homepage) and its visibility.
			const created = db().prepare("INSERT INTO albums (title, type, status, created_at, converted_from) VALUES (?, 'uploaded', ?, ?, ?)").run(old.title, old.status, old.created_at, albumId);
			const id = Number(created.lastInsertRowid);
			const insert = db().prepare('INSERT INTO photos (album_id, position, url, thumb_url, alt, width, height, storage_key) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)');
			let cover = 0;
			rows.forEach((row, i) => {
				const newPhoto = Number(insert.run(id, i, stored[i]!.url, row.alt, row.width, row.height, stored[i]!.key).lastInsertRowid);
				if (row.id === old.cover_photo_id || (i === 0 && cover === 0)) cover = newPhoto;
			});
			db().prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(cover, id);
			db().prepare('INSERT INTO album_categories (album_id, category_id) SELECT ?, category_id FROM album_categories WHERE album_id = ?').run(id, albumId);
			db().prepare('INSERT INTO album_sources (album_id, kind, url, final_url, title, created_at) SELECT ?, kind, url, final_url, title, created_at FROM album_sources WHERE album_id = ?').run(id, albumId);
			// Only now, with the copy complete, is the old album put away.
			db().prepare("UPDATE albums SET status = 'deactivated', converted_to = ? WHERE id = ?").run(id, albumId);
			audit(actorId, 'album.convert', String(albumId), `to ${id}, ${total} photos, ${new Set(keys).size} stored`);
			return id;
		});
		return { ok: true, newAlbumId, photos: total, stored: new Set(keys).size };
	} catch (error) {
		await removeUnreferenced(keys);
		throw error;
	}
}
