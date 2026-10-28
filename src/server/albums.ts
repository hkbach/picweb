import { db } from './db.ts';
import { audit } from './audit.ts';
import { MEDIA_KEY, getStorage } from './storage.ts';

// The rules for creating and changing albums, shared by every album endpoint. The Create/Edit forms check
// the same things only to help the person typing; these are the checks that count.
export const MAX_ALBUM_PHOTOS = 50; // same as the forms
export const TITLE_MAX = 80;
export const ALT_MAX = 150;
const URL_MAX = 2048;

/** A refusal whose message is safe to show to the administrator. */
export class AlbumError extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}

export const cleanTitle = (value: unknown): string => {
	const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
	if (title.length < 1 || title.length > TITLE_MAX || /[\u0000-\u001f<>]/.test(title)) throw new AlbumError(`Give the album a title of up to ${TITLE_MAX} characters.`);
	return title;
};

/** Every id must be a category that exists; at least one is needed whenever any category exists. */
export const cleanCategoryIds = (value: unknown): string[] => {
	if (!Array.isArray(value) || value.length > 30) throw new AlbumError('Choose the categories again.');
	const known = new Set((db().prepare('SELECT id FROM categories').all() as Array<{ id: string }>).map((r) => r.id));
	const ids = [...new Set(value.map((v) => (typeof v === 'string' ? v : '')))];
	if (ids.some((id) => !known.has(id))) throw new AlbumError('One of the chosen categories no longer exists. Reload the page.', 409);
	if (known.size > 0 && ids.length === 0) throw new AlbumError('Choose at least one category.');
	return ids;
};

const cleanAlt = (value: unknown): string => {
	const alt = typeof value === 'string' ? value.trim() : '';
	if (alt.length > ALT_MAX || /[\u0000-\u001f]/.test(alt)) throw new AlbumError(`A photo description can have up to ${ALT_MAX} characters.`);
	return alt;
};

const cleanSize = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : 0);

/** Only http(s) addresses are kept; the server never fetches them. */
export const cleanRemoteUrl = (value: unknown): string => {
	if (typeof value !== 'string' || value.length > URL_MAX) throw new AlbumError('A photo has an invalid address.');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new AlbumError('A photo has an invalid address.');
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new AlbumError('A photo has an invalid address.');
	return url.href;
};

export interface NewSource {
	kind: 'web' | 'facebook';
	url: string;
	finalUrl: string | null;
	title: string;
}

const MAX_SOURCES = 20;

/**
 * The crawl history sent with a new album: where its pictures were crawled from. The original address is kept as the
 * administrator typed it; both must be plain http(s) addresses without credentials. The server never fetches them.
 */
export function cleanSources(value: unknown): NewSource[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > MAX_SOURCES) throw new AlbumError('The list of crawled addresses is not valid.');
	const seen = new Set<string>();
	const sources: NewSource[] = [];
	for (const item of value) {
		const kind = item?.kind === 'facebook' ? 'facebook' : item?.kind === 'web' ? 'web' : null;
		const typed = typeof item?.url === 'string' ? item.url.trim() : '';
		if (!kind || typed.length < 1 || typed.length > URL_MAX || /[\u0000-\u0020\u007f]/.test(typed)) throw new AlbumError('A crawled address is not valid.');
		cleanRemoteUrl(typed); // must be an http(s) address with no credentials
		const final = typeof item.finalUrl === 'string' && item.finalUrl.trim() !== '' ? cleanRemoteUrl(item.finalUrl.trim()) : null;
		const title = typeof item.title === 'string' ? item.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : '';
		const key = `${kind} ${typed}`;
		if (seen.has(key)) continue;
		seen.add(key);
		sources.push({ kind, url: typed, finalUrl: final, title });
	}
	return sources;
}

export interface NewPhoto {
	url: string;
	alt: string;
	width: number;
	height: number;
	storageKey: string | null;
}

export const cleanPhotoMeta = (p: any) => ({ alt: cleanAlt(p?.alt), width: cleanSize(p?.width), height: cleanSize(p?.height) });

export const parsePhotoCount = (list: unknown): any[] => {
	if (!Array.isArray(list) || list.length < 1) throw new AlbumError('Add at least one photo.');
	if (list.length > MAX_ALBUM_PHOTOS) throw new AlbumError(`An album can have at most ${MAX_ALBUM_PHOTOS} photos.`);
	return list;
};

function setCategories(albumId: number, categoryIds: string[]) {
	db().prepare('DELETE FROM album_categories WHERE album_id = ?').run(albumId);
	const insert = db().prepare('INSERT INTO album_categories (album_id, category_id) VALUES (?, ?)');
	for (const id of categoryIds) insert.run(albumId, id);
}

/** Must be called inside a transaction. Returns the new album's id. */
export function insertAlbum(actorId: string, input: { title: string; type: 'crawling' | 'uploaded'; categoryIds: string[]; coverIndex: number; photos: NewPhoto[]; sources?: NewSource[] }): number {
	if (input.coverIndex < 0 || input.coverIndex >= input.photos.length) throw new AlbumError('Choose which photo is the cover.');
	const result = db().prepare('INSERT INTO albums (title, type, created_at) VALUES (?, ?, ?)').run(input.title, input.type, new Date().toISOString());
	const albumId = Number(result.lastInsertRowid);
	const insert = db().prepare('INSERT INTO photos (album_id, position, url, thumb_url, alt, width, height, storage_key) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)');
	let coverId = 0;
	input.photos.forEach((p, i) => {
		const r = insert.run(albumId, i, p.url, p.alt, p.width, p.height, p.storageKey);
		if (i === input.coverIndex) coverId = Number(r.lastInsertRowid);
	});
	db().prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(coverId, albumId);
	setCategories(albumId, input.categoryIds);
	const addSource = db().prepare('INSERT INTO album_sources (album_id, kind, url, final_url, title, created_at) VALUES (?, ?, ?, ?, ?, ?)');
	const now = new Date().toISOString();
	for (const s of input.sources ?? []) addSource.run(albumId, s.kind, s.url, s.finalUrl, s.title, now);
	audit(actorId, 'album.create', String(albumId), `${input.type}, ${input.photos.length} photos, ${(input.sources ?? []).length} sources`);
	return albumId;
}

/**
 * Must be called inside a transaction. Photos whose address is already in the album keep their id (anything that
 * refers to them, such as a like, stays valid); the rest are added, and photos left out are removed.
 * Returns the storage keys of removed pictures, for the caller to delete once the change is committed.
 */
export function replaceAlbum(actorId: string, albumId: number, input: { title: string; categoryIds: string[]; coverIndex: number; photos: NewPhoto[] }): string[] {
	if (input.coverIndex < 0 || input.coverIndex >= input.photos.length) throw new AlbumError('Choose which photo is the cover.');
	db().prepare('UPDATE albums SET title = ? WHERE id = ?').run(input.title, albumId);
	const existing = db().prepare('SELECT id, url, storage_key FROM photos WHERE album_id = ?').all(albumId) as unknown as Array<{ id: number; url: string; storage_key: string | null }>;
	const free = new Map<string, Array<{ id: number; storage_key: string | null }>>();
	for (const e of existing) free.set(e.url, [...(free.get(e.url) ?? []), e]);

	const keep = new Set<number>();
	let coverId = 0;
	const update = db().prepare('UPDATE photos SET position = ?, alt = ?, width = ?, height = ? WHERE id = ?');
	const insert = db().prepare('INSERT INTO photos (album_id, position, url, thumb_url, alt, width, height, storage_key) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)');
	input.photos.forEach((p, i) => {
		const match = free.get(p.url)?.shift();
		let id: number;
		if (match) {
			update.run(i, p.alt, p.width, p.height, match.id);
			id = match.id;
		} else {
			id = Number(insert.run(albumId, i, p.url, p.alt, p.width, p.height, p.storageKey).lastInsertRowid);
		}
		keep.add(id);
		if (i === input.coverIndex) coverId = id;
	});
	const removedKeys: string[] = [];
	for (const e of existing) {
		if (keep.has(e.id)) continue;
		db().prepare('DELETE FROM photos WHERE id = ?').run(e.id);
		if (e.storage_key) removedKeys.push(e.storage_key);
	}
	db().prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(coverId, albumId);
	setCategories(albumId, input.categoryIds);
	audit(actorId, 'album.update', String(albumId), `${input.photos.length} photos, ${removedKeys.length} stored removed`);
	return removedKeys;
}

/** Deletes stored pictures that no photo refers to any more (after a change committed, or one that failed). */
export async function removeUnreferenced(keys: string[]) {
	const storage = getStorage();
	if (!storage) return;
	for (const key of new Set(keys)) {
		if (!MEDIA_KEY.test(key)) continue;
		const used = db().prepare('SELECT 1 FROM photos WHERE storage_key = ? LIMIT 1').get(key);
		if (!used) await storage.remove(key).catch(() => {});
	}
}
