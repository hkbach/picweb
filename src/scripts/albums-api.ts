import { savedNameFromUrl } from './album-draft';

// Album service calls. No backend or database exists yet, so nothing here can really store an album.
// Replace the body of createAlbum with a request to the real service; the Create new album page
// already handles each result below. (createAlbumFromUploads is the exception: it already posts to a
// server endpoint, which answers "not implemented" until the host is integrated.)
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
}

export type AlbumResult = { ok: true } | { ok: false; reason: 'not-configured' | 'error' };

export async function createAlbum(_album: AlbumInput): Promise<AlbumResult> {
	return { ok: false, reason: 'not-configured' };
}

/** Changes to an existing album made from image links. The album keeps its original type. */
export interface AlbumUpdateInput extends AlbumInput {
	id: number;
}

export async function updateAlbum(_album: AlbumUpdateInput): Promise<AlbumResult> {
	return { ok: false, reason: 'not-configured' };
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
}

// The checks the Upload tab makes (type, size) only help the person using the form. A real service
// must repeat them on the server and also verify the file content, not trust the browser's file type.
//
// Sends the album to the server as one multipart request (see src/pages/api/admin/albums/upload.ts, where
// the host is to be integrated). `{ ok: true }` must mean the album AND every photo are safely stored: the
// page deletes its downloaded copies as soon as it sees it. Anything else leaves them untouched.
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
	body.append('meta', JSON.stringify({ title: album.title, type: album.type, categoryIds: album.categoryIds, coverIndex: album.coverIndex, photos }));

	try {
		const response = await fetch('/api/admin/albums/upload', { method: 'POST', body });
		if (response.ok) return { ok: true };
		// 501: the server has no album storage yet.
		return { ok: false, reason: response.status === 501 ? 'not-configured' : 'error' };
	} catch {
		return { ok: false, reason: 'error' };
	}
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

export async function updateAlbumWithUploads(_album: UploadAlbumUpdateInput): Promise<AlbumResult> {
	return { ok: false, reason: 'not-configured' };
}
