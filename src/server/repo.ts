import { db } from './db.ts';

// Reads used by the pages that are rendered on the server.

export interface Category {
	id: string;
	name: string;
}

export function listCategories(): Category[] {
	return db().prepare('SELECT id, name FROM categories ORDER BY position').all() as unknown as Category[];
}

export interface UserRow {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	status: 'active' | 'deactivated';
	/** Registration day as YYYY-MM-DD (UTC). */
	registeredAt: string;
}

export function listUsers(): UserRow[] {
	const rows = db().prepare('SELECT id, first_name, last_name, email, status, created_at FROM users ORDER BY created_at').all() as Array<{
		id: string;
		first_name: string;
		last_name: string;
		email: string;
		status: 'active' | 'deactivated';
		created_at: string;
	}>;
	return rows.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, status: r.status, registeredAt: r.created_at.slice(0, 10) }));
}

// ---- albums and photos

/** How an album was created: from online image links (Crawling) or files from a device (Uploaded). */
export type AlbumType = 'crawling' | 'uploaded';

export const albumTypeLabels: Record<AlbumType, string> = {
	crawling: 'Crawling',
	uploaded: 'Uploaded',
};

export interface Photo {
	id: number;
	album: number;
	albumTitle: string;
	width: number;
	height: number;
	alt: string;
	/** The full picture. */
	src: string;
	/** A smaller picture for grids; the full one when there is no smaller one. */
	thumb: string;
}

export type AlbumStatus = 'active' | 'deactivated';

export interface Album {
	id: number;
	title: string;
	type: AlbumType;
	/** A deactivated album is hidden from the public site; only a deactivated album can be deleted. */
	status: AlbumStatus;
	/** The album this one is a converted copy of, if it is one. */
	convertedFrom: number | null;
	/** The converted copy that replaced this album, if it was converted. */
	convertedTo: number | null;
	/** When the album was created (ISO time). */
	createdAt: string;
	/** How many different pictures of this album are kept in the photo storage (Cloudflare R2), not on another site. */
	storedCount: number;
	categoryIds: string[];
	cover: Photo;
	photos: Photo[];
}

interface PhotoRow {
	id: number;
	album_id: number;
	title: string;
	url: string;
	thumb_url: string | null;
	alt: string;
	width: number;
	height: number;
}

const toPhoto = (r: PhotoRow): Photo => ({ id: r.id, album: r.album_id, albumTitle: r.title, width: r.width, height: r.height, alt: r.alt, src: r.url, thumb: r.thumb_url ?? r.url });

const PHOTO_SELECT = 'SELECT p.id, p.album_id, a.title, p.url, p.thumb_url, p.alt, p.width, p.height FROM photos p JOIN albums a ON a.id = p.album_id';

/**
 * Every photo, album by album, in each album's own order. Pass `onlyActive` for anything a visitor can see: the
 * photos of a deactivated album are left out.
 */
export function listPhotos(onlyActive = false): Photo[] {
	const where = onlyActive ? "WHERE a.status = 'active'" : '';
	return (db().prepare(`${PHOTO_SELECT} ${where} ORDER BY a.id, p.position`).all() as unknown as PhotoRow[]).map(toPhoto);
}

export function listAlbums(): Album[] {
	const albums = db().prepare('SELECT id, title, type, status, cover_photo_id, created_at, converted_from, converted_to FROM albums ORDER BY id').all() as Array<{ id: number; title: string; type: AlbumType; status: AlbumStatus; cover_photo_id: number | null; created_at: string; converted_from: number | null; converted_to: number | null }>;
	const photos = listPhotos();
	const byAlbum = new Map<number, Photo[]>();
	for (const p of photos) byAlbum.set(p.album, [...(byAlbum.get(p.album) ?? []), p]);
	const stored = new Map((db().prepare('SELECT album_id, COUNT(DISTINCT storage_key) AS n FROM photos WHERE storage_key IS NOT NULL GROUP BY album_id').all() as Array<{ album_id: number; n: number }>).map((r) => [r.album_id, r.n]));
	const cats = db().prepare('SELECT ac.album_id, ac.category_id FROM album_categories ac JOIN categories c ON c.id = ac.category_id ORDER BY c.position').all() as Array<{ album_id: number; category_id: string }>;
	const catsOf = new Map<number, string[]>();
	for (const c of cats) catsOf.set(c.album_id, [...(catsOf.get(c.album_id) ?? []), c.category_id]);
	return albums.flatMap((a) => {
		const list = byAlbum.get(a.id) ?? [];
		if (list.length === 0) return [];
		return [{ id: a.id, title: a.title, type: a.type, status: a.status, convertedFrom: a.converted_from, convertedTo: a.converted_to, createdAt: a.created_at, storedCount: stored.get(a.id) ?? 0, categoryIds: catsOf.get(a.id) ?? [], cover: list.find((p) => p.id === a.cover_photo_id) ?? list[0], photos: list }];
	});
}

/**
 * What the Homepage shows: one picture per album, its cover, the most recently created album first. With a
 * category given, only the albums in that category; an album that belongs to no category is therefore never
 * listed once a category is chosen.
 */
export function listAlbumCovers(categoryId?: string): Photo[] {
	return listAlbums()
		.filter((a) => a.status === 'active') // a deactivated album is not shown to visitors
		.filter((a) => !categoryId || a.categoryIds.includes(categoryId))
		// Newest first. Albums made in the same instant (ids grow with time) keep the later one first.
		.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id))
		.map((a) => a.cover);
}

export interface AlbumSource {
	kind: 'web' | 'facebook';
	/** The address as the administrator typed it. */
	url: string;
	/** Where it led (for example a Facebook share link becomes the post's own address); null when it was the same. */
	finalUrl: string | null;
	title: string;
	/** When the album was created from it (ISO time). */
	createdAt: string;
}

/** The crawl history of an album: every address crawled to collect its pictures, in the order they were crawled. */
export function listAlbumSources(albumId: number): AlbumSource[] {
	const rows = db().prepare('SELECT kind, url, final_url, title, created_at FROM album_sources WHERE album_id = ? ORDER BY id').all(albumId) as Array<{ kind: 'web' | 'facebook'; url: string; final_url: string | null; title: string | null; created_at: string }>;
	return rows.map((r) => ({ kind: r.kind, url: r.url, finalUrl: r.final_url && r.final_url !== r.url ? r.final_url : null, title: r.title ?? '', createdAt: r.created_at }));
}

export function getAlbum(id: number): Album | undefined {
	return listAlbums().find((a) => a.id === id);
}

// ---- a user's liked photos and favorites

type Reaction = 'likes' | 'favorites';

/** The user's photos for one list, newest first. */
function listReacted(table: Reaction, userId: string): Photo[] {
	return (db().prepare(`${PHOTO_SELECT} JOIN ${table} r ON r.photo_id = p.id WHERE r.user_id = ? AND a.status = 'active' ORDER BY r.created_at DESC, p.id DESC`).all(userId) as unknown as PhotoRow[]).map(toPhoto);
}

export const listLiked = (userId: string) => listReacted('likes', userId);
export const listFavorites = (userId: string) => listReacted('favorites', userId);

/** Ids only, for marking the buttons on the pages. */
export function reactionState(userId: string): { liked: number[]; favorites: number[] } {
	const ids = (table: Reaction) => (db().prepare(`SELECT photo_id FROM ${table} WHERE user_id = ?`).all(userId) as Array<{ photo_id: number }>).map((r) => r.photo_id);
	return { liked: ids('likes'), favorites: ids('favorites') };
}
