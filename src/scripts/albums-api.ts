import { savedNameFromUrl, type CrawlSourceInfo } from './album-draft';

// Album service calls (see src/pages/api/admin/albums). Albums made from image links are stored as
// addresses only. Albums made from files need photo storage on the server (STORAGE_DRIVER, see
// src/server/storage.ts): until it is configured those calls answer 501, reported here as 'not-configured'.
export interface AlbumPhotoInput {
	url: string;
	alt: string;
	/** Natural size measured in the browser; 0 when the image could not be measured. */
	width: number;
	height: number;
}

export interface AlbumInput {
	title: string;
	/** Albums made from image links (the From URLs tab, typically crawled) are of type "crawling". */
	type: 'crawling';
	/** Categories this album belongs to (at least one when any category exists). */
	categoryIds: string[];
	/** The photo shown as this album's thumbnail on the Homepage. Always one of `photos[].url`. */
	coverUrl: string;
	photos: AlbumPhotoInput[];
	/** The pages crawled to collect the pictures (history kept with the album); empty for an album typed in by hand. */
	sources?: CrawlSourceInfo[];
}

export type AlbumResult = { ok: true } | { ok: false; reason: 'not-configured' | 'error'; error?: string };

// Sends a request and turns the answer into an AlbumResult. A 501 means the server has no photo storage yet.
async function send(url: string, method: string, body: BodyInit, json: boolean): Promise<AlbumResult> {
	try {
		const response = await fetch(url, { method, headers: json ? { 'content-type': 'application/json' } : undefined, body, credentials: 'same-origin' });
		if (response.ok) return { ok: true };
		const data = await response.json().catch(() => ({}));
		const error = typeof data.error === 'string' ? data.error : undefined;
		return response.status === 501 ? { ok: false, reason: 'not-configured', error } : { ok: false, reason: 'error', error };
	} catch {
		return { ok: false, reason: 'error' };
	}
}

export async function createAlbum(album: AlbumInput): Promise<AlbumResult> {
	return send('/api/admin/albums', 'POST', JSON.stringify(album), true);
}

/** Changes to an existing album made from image links. The album keeps its original type. */
export interface AlbumUpdateInput extends AlbumInput {
	id: number;
}

export async function updateAlbum(album: AlbumUpdateInput): Promise<AlbumResult> {
	return send(`/api/admin/albums/${album.id}`, 'PUT', JSON.stringify(album), true);
}

export interface UploadedPhotoInput {
	/** A file chosen on this device. */
	file?: File;
	/**
	 * Or an image already saved on the server (one downloaded from the Crawling page), as its
	 * `/api/admin/photos/<name>` address. Exactly one of `file` and `storedUrl` is set.
	 */
	storedUrl?: string;
	alt: string;
	/** Natural size measured in the browser. */
	width: number;
	height: number;
}

export interface UploadAlbumInput {
	title: string;
	/** Albums made from files on the device (the Upload tab) are of type "uploaded". */
	type: 'uploaded';
	/** Categories this album belongs to (at least one when any category exists). */
	categoryIds: string[];
	/** Index in `photos` of the Homepage thumbnail. */
	coverIndex: number;
	photos: UploadedPhotoInput[];
	/** The pages crawled to collect the pictures that were downloaded (history kept with the album). */
	sources?: CrawlSourceInfo[];
}

// The checks the Upload tab makes (type, size) only help the person using the form: the server repeats
// them and verifies each file's content (src/pages/api/admin/albums/upload.ts).
//
// Sends the album to the server as one multipart request. `{ ok: true }` means the album AND every photo are
// stored: the page deletes its downloaded copies as soon as it sees it. Anything else leaves them untouched.
export async function createAlbumFromUploads(album: UploadAlbumInput): Promise<AlbumResult> {
	const body = new FormData();
	const photos = [];
	for (const [i, photo] of album.photos.entries()) {
		const common = { alt: photo.alt, width: photo.width, height: photo.height };
		if (photo.file) {
			// The part is named by position; the browser's own file name is not sent as data.
			body.append(`file${i}`, photo.file, `file${i}`);
			photos.push({ ...common, part: `file${i}` });
		} else {
			const storedName = savedNameFromUrl(photo.storedUrl ?? '');
			if (!storedName) return { ok: false, reason: 'error' };
			photos.push({ ...common, storedName });
		}
	}
	body.append('meta', JSON.stringify({ title: album.title, type: album.type, categoryIds: album.categoryIds, coverIndex: album.coverIndex, photos, sources: album.sources ?? [] }));

	return send('/api/admin/albums/upload', 'POST', body, false);
}

/** A photo in an edited uploaded album: either already stored (existingUrl) or newly chosen (file). */
export interface UpdatedUploadPhoto {
	existingUrl?: string;
	file?: File;
	alt: string;
	width: number;
	height: number;
}

/** Changes to an existing album made from device uploads. Same server-side checks apply as for creation. */
export interface UploadAlbumUpdateInput {
	id: number;
	title: string;
	type: 'uploaded';
	categoryIds: string[];
	/** Index in `photos` of the Homepage thumbnail. */
	coverIndex: number;
	photos: UpdatedUploadPhoto[];
}

export async function updateAlbumWithUploads(album: UploadAlbumUpdateInput): Promise<AlbumResult> {
	const body = new FormData();
	const photos = [];
	for (const [i, photo] of album.photos.entries()) {
		const common = { alt: photo.alt, width: photo.width, height: photo.height };
		if (photo.file) {
			body.append(`file${i}`, photo.file, `file${i}`);
			photos.push({ ...common, part: `file${i}` });
		} else {
			photos.push({ ...common, existingUrl: photo.existingUrl });
		}
	}
	body.append('meta', JSON.stringify({ title: album.title, type: album.type, categoryIds: album.categoryIds, coverIndex: album.coverIndex, photos }));
	return send(`/api/admin/albums/${album.id}/upload`, 'PUT', body, false);
}
