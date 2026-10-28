import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { DATA_DIR } from './db.ts';

// Where pictures that this site stores itself (uploads from a device, or downloads from the Crawling page)
// are kept. Pictures from "From URLs" albums are not stored here: they stay on the site they came from.
//
// The cloud host is chosen with STORAGE_DRIVER. Nothing is stored until one is set, and the upload
// endpoints answer 501 ("not implemented") instead of pretending:
//   STORAGE_DRIVER=local   keeps files in DATA_DIR/uploads and serves them from /api/media/<name>. For
//                          development and tests, and for a single server; it is not a cloud host.
// A cloud adapter (S3, Azure Blob, ...) is added by implementing PhotoStorage below and returning it from
// getStorage(). It must put the object, return a public https address for it, and delete it again.
export interface PhotoStorage {
	/** Stores `bytes` under `key` (replacing an identical object is fine) and returns the address pictures are shown from. */
	put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
	remove(key: string): Promise<void>;
}

/** Names this server gives stored pictures: 32 hex characters of the content hash, then the type. */
export const MEDIA_KEY = /^[a-f0-9]{32}\.(jpg|png|gif|webp)$/;

export const MEDIA_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const local: PhotoStorage = {
	async put(key, bytes) {
		if (!MEDIA_KEY.test(key)) throw new Error('Invalid storage key.');
		await mkdir(UPLOADS_DIR, { recursive: true });
		await writeFile(path.join(UPLOADS_DIR, key), bytes);
		return `/api/media/${key}`;
	},
	async remove(key) {
		if (!MEDIA_KEY.test(key)) return;
		await unlink(path.join(UPLOADS_DIR, key)).catch(() => {});
	},
};

export const storageDriver = () => process.env.STORAGE_DRIVER ?? '';

/** The configured storage, or null when none is. */
export function getStorage(): PhotoStorage | null {
	if (storageDriver() === 'local') return local;
	return null;
}

/** Reads a stored picture from the local driver (used to serve /api/media). */
export async function readLocal(key: string): Promise<Buffer | null> {
	if (!MEDIA_KEY.test(key)) return null;
	try {
		return await readFile(path.join(UPLOADS_DIR, key));
	} catch {
		return null;
	}
}
