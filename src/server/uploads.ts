import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { sniffImage } from '../../crawler/download-image.ts';
import { PHOTOS_DIR, SAVED_NAME, adminApiEnabled } from './admin-api.ts';
import { AlbumError, cleanPhotoMeta, parsePhotoCount } from './albums.ts';
import { MEDIA_TYPES, type PhotoStorage } from './storage.ts';

// Reads the multipart request of the Upload tab: a "meta" JSON part and one file part per device photo.
// Whatever the browser said about a file (its name, its type) is ignored: the bytes decide what it is.
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // same limit the form shows
/** The whole request is held in memory while it is checked, so it is capped. */
export const MAX_REQUEST_BYTES = 120 * 1024 * 1024;

export interface UploadedItem {
	alt: string;
	width: number;
	height: number;
	/** A picture that is already in the album (edit only): kept as it is. */
	existingUrl?: string;
	/** A new picture, checked and ready to store. */
	bytes?: Uint8Array;
	type?: 'jpg' | 'png' | 'gif' | 'webp';
	key?: string;
}

export interface UploadRequest {
	meta: Record<string, any>;
	items: UploadedItem[];
}

export async function readUploadRequest(request: Request): Promise<UploadRequest> {
	const declared = Number(request.headers.get('content-length'));
	if (!Number.isFinite(declared) || declared > MAX_REQUEST_BYTES) throw new AlbumError('The upload is too large.', 413);

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw new AlbumError('The upload could not be read.');
	}
	let meta: any;
	try {
		const raw = form.get('meta');
		meta = typeof raw === 'string' ? JSON.parse(raw) : null;
	} catch {
		meta = null;
	}
	if (!meta || typeof meta !== 'object') throw new AlbumError('The upload could not be read.');

	const items: UploadedItem[] = [];
	for (const [i, p] of parsePhotoCount(meta.photos).entries()) {
		const common = cleanPhotoMeta(p);
		if (typeof p?.existingUrl === 'string') {
			items.push({ ...common, existingUrl: p.existingUrl });
			continue;
		}
		let bytes: Uint8Array;
		if (typeof p?.part === 'string') {
			const file = form.get(p.part);
			if (!(file instanceof File)) throw new AlbumError(`Photo ${i + 1} is missing.`);
			if (file.size > MAX_FILE_BYTES) throw new AlbumError(`Photo ${i + 1} is larger than 10 MB.`);
			bytes = new Uint8Array(await file.arrayBuffer());
		} else if (typeof p?.storedName === 'string') {
			// A picture downloaded earlier into photos_dowloaded: only names this server generated are opened.
			if (!adminApiEnabled || !SAVED_NAME.test(p.storedName)) throw new AlbumError(`Photo ${i + 1} is not available.`);
			const file = path.join(PHOTOS_DIR, p.storedName);
			const info = await stat(file).catch(() => null);
			if (!info?.isFile()) throw new AlbumError(`Photo ${i + 1} is no longer on the server. Download it again.`, 409);
			if (info.size > 15 * 1024 * 1024) throw new AlbumError(`Photo ${i + 1} is too large.`);
			bytes = new Uint8Array(await readFile(file));
		} else {
			throw new AlbumError(`Photo ${i + 1} is missing.`);
		}
		const type = sniffImage(bytes);
		if (!type) throw new AlbumError(`Photo ${i + 1} is not a JPG, PNG, GIF or WebP image.`);
		const key = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${type}`;
		items.push({ ...common, bytes, type, key });
	}
	return { meta, items };
}

/** Stores every new picture and returns their addresses by key. Throws if any cannot be stored. */
export async function storeItems(storage: PhotoStorage, items: UploadedItem[]): Promise<Map<string, string>> {
	const urls = new Map<string, string>();
	for (const item of items) {
		if (!item.bytes || !item.key || urls.has(item.key)) continue;
		urls.set(item.key, await storage.put(item.key, item.bytes, MEDIA_TYPES[item.type!]));
	}
	return urls;
}
