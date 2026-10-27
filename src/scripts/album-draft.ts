// Hands a list of images from the Crawling page to the Create new album page.
// It lives in sessionStorage: it stays in this tab only and is deleted as soon as it is read.
export const MAX_ALBUM_PHOTOS = 50;

export interface AlbumDraft {
	title: string;
	/** The page the images were crawled from. */
	source: string;
	photos: Array<{ url: string; alt: string }>;
}

const KEY = 'picweb:album-draft';

const isHttpUrl = (value: string) => {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
};

export function saveDraft(draft: AlbumDraft): boolean {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(draft));
		return true;
	} catch {
		return false;
	}
}

/** Returns the draft once, then removes it. Anything that is not a plain http(s) image list is dropped. */
export function takeDraft(): AlbumDraft | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		sessionStorage.removeItem(KEY);
		if (!raw) return null;
		const data = JSON.parse(raw);
		if (!Array.isArray(data?.photos)) return null;
		const photos = data.photos
			.filter((p: unknown) => typeof (p as { url?: unknown })?.url === 'string' && isHttpUrl((p as { url: string }).url))
			.map((p: { url: string; alt?: unknown }) => ({ url: p.url, alt: typeof p.alt === 'string' ? p.alt : '' }));
		if (photos.length === 0) return null;
		return {
			title: typeof data.title === 'string' ? data.title : '',
			source: typeof data.source === 'string' ? data.source : '',
			photos,
		};
	} catch {
		return null;
	}
}

// ---- Photos downloaded by the Crawling page, handed to the Upload tab of Create new album.
// Unlike the draft above these are files already saved on the server, so only their addresses travel.
export interface DownloadedDraft {
	title: string;
	/** The page the images were crawled from. */
	source: string;
	photos: Array<{ url: string; alt: string }>;
}

const DOWNLOADED_KEY = 'picweb:album-draft-downloaded';
// The only addresses accepted: images this site's download endpoint saved. Nothing else is trusted.
const SAVED_URL = /^\/api\/admin\/photos\/(?:[a-f0-9]{32}|[a-z0-9]+-[a-f0-9]{12})\.(?:jpg|png|gif|webp)$/;

export function saveDownloadedDraft(draft: DownloadedDraft): boolean {
	try {
		sessionStorage.setItem(DOWNLOADED_KEY, JSON.stringify(draft));
		return true;
	} catch {
		return false;
	}
}

/** Returns the downloaded photos once, then removes them. Entries that are not saved-image addresses are dropped. */
export function takeDownloadedDraft(): DownloadedDraft | null {
	try {
		const raw = sessionStorage.getItem(DOWNLOADED_KEY);
		sessionStorage.removeItem(DOWNLOADED_KEY);
		if (!raw) return null;
		const data = JSON.parse(raw);
		if (!Array.isArray(data?.photos)) return null;
		const photos = data.photos
			.filter((p: { url?: unknown }) => typeof p?.url === 'string' && SAVED_URL.test(p.url))
			.map((p: { url: string; alt?: unknown }) => ({ url: p.url, alt: typeof p.alt === 'string' ? p.alt : '' }));
		if (photos.length === 0) return null;
		return {
			title: typeof data.title === 'string' ? data.title : '',
			source: typeof data.source === 'string' ? data.source : '',
			photos,
		};
	} catch {
		return null;
	}
}

// ---- Names of every photo this tab has downloaded, kept until they are used or cleared.
// The handover above is used up when the album form opens, so without this list a photo that was
// removed from the form, or a page that was reloaded, would leave files nobody could clean up.
const NAMES_KEY = 'picweb:downloaded-names';
const SAVED_NAME = /^(?:[a-f0-9]{32}|[a-z0-9]+-[a-f0-9]{12})\.(?:jpg|png|gif|webp)$/;

/** The file name at the end of a `/api/admin/photos/<name>` address, or null if it is not one. */
export function savedNameFromUrl(url: string): string | null {
	const match = /^\/api\/admin\/photos\/([^/?#]+)$/.exec(url);
	return match && SAVED_NAME.test(match[1]) ? match[1] : null;
}

export function readDownloadedNames(): string[] {
	try {
		const list = JSON.parse(sessionStorage.getItem(NAMES_KEY) ?? '[]');
		return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string' && SAVED_NAME.test(n)) : [];
	} catch {
		return [];
	}
}

function writeDownloadedNames(names: string[]) {
	try {
		if (names.length === 0) sessionStorage.removeItem(NAMES_KEY);
		else sessionStorage.setItem(NAMES_KEY, JSON.stringify(names));
	} catch {
		// storage unavailable: the list just cannot be remembered
	}
}

export function rememberDownloadedNames(names: string[]) {
	writeDownloadedNames([...new Set([...readDownloadedNames(), ...names.filter((n) => SAVED_NAME.test(n))])]);
}

/** Stop remembering these names (they were deleted, or the album that uses them was created). */
export function forgetDownloadedNames(names?: string[]) {
	writeDownloadedNames(names ? readDownloadedNames().filter((n) => !names.includes(n)) : []);
}
