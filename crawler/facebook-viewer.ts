import type { Page } from 'playwright';

// Reads the pictures of ONE public Facebook post the way a visitor does: close the "Log in" suggestion, click a
// photo to open Facebook's photo viewer, then press its "Next photo" button until every photo was seen. The
// viewer shows each photo at a much larger size than the post page does (about 1500 px instead of 590 px).
//
// It never signs in, never fills a form and never sends an account detail. If Facebook asks for a login at any
// point it stops and keeps what it already has. It goes one photo at a time with a short pause between them.
export interface ViewerPhoto {
	url: string;
	alt: string;
	width: number;
	height: number;
}

export type ViewerStop =
	| 'no-photo-link' // the post has no photo to open (for example a text post): nothing to walk through
	| 'viewer-not-opened'
	| 'last' // there is no "Next photo" button
	| 'cycle' // the viewer went back to a photo already seen: that was all of them
	| 'limit' // the maximum number of photos was reached
	| 'login' // Facebook asked for a login
	| 'stuck' // pressing Next did not show another photo
	| 'out-of-time';

export interface ViewerOptions {
	maxPhotos: number;
	/** Pause between two photos, so the pages are read one at a time and not in a burst. */
	pauseMs: number;
	/** Date.now() value after which no new photo is started. */
	stopAt: number;
}

const PHOTO_LINK = 'a[href*="/photo/?fbid"], a[href*="/photo.php?fbid"], a[href*="/photo?fbid"]';
const NEXT = '[aria-label="Next photo"]';
const VIEWER_SIGNS = `${NEXT}, [aria-label="Previous photo"], [aria-label="Photo viewer"]`;
const NO_DESCRIPTION = /^no photo description available\.?$/i;

/** The file name of a picture: the same picture keeps it whatever size or signature the address carries. */
export const pictureName = (url: string): string => {
	try {
		return new URL(url).pathname.split('/').pop() ?? '';
	} catch {
		return '';
	}
};

const isLoginAddress = (page: Page) => {
	try {
		return /^\/(login|checkpoint|recover)(\/|\.php|$)/i.test(new URL(page.url()).pathname);
	} catch {
		return false;
	}
};

/** The "Log in to see more" suggestion covers the page and blocks clicks; its Close button dismisses it. */
export async function dismissLoginSuggestion(page: Page): Promise<boolean> {
	const suggestion = page.locator('[role="dialog"]', { hasText: /log in/i }).filter({ has: page.locator('[aria-label="Close"]') }).first();
	if ((await suggestion.count()) === 0) return false;
	// Only a dialog that is just the suggestion: never touch the viewer or the post itself.
	if ((await suggestion.locator(VIEWER_SIGNS).count()) > 0) return false;
	await suggestion.locator('[aria-label="Close"]').first().click({ timeout: 5000 }).catch(() => {});
	await page.waitForTimeout(500);
	return true;
}

/** The photo the viewer shows now: the largest loaded picture from Facebook's picture hosts inside a dialog. */
export async function currentPhoto(page: Page): Promise<ViewerPhoto | null> {
	return page.evaluate(() => {
		let best: { url: string; alt: string; width: number; height: number } | null = null;
		for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
			for (const img of Array.from(dialog.querySelectorAll('img'))) {
				if (!img.complete || img.naturalWidth < 300 || img.naturalHeight < 300) continue;
				let host = '';
				try {
					host = new URL(img.currentSrc || img.src).hostname;
				} catch {
					continue;
				}
				if (!/(^|\.)fbcdn\.net$/i.test(host) || /^static\./i.test(host)) continue;
				const rect = img.getBoundingClientRect();
				if (rect.width < 50 || rect.height < 50) continue; // not actually shown
				if (!best || img.naturalWidth * img.naturalHeight > best.width * best.height) best = { url: img.currentSrc || img.src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight };
			}
		}
		return best;
	});
}

async function openViewer(page: Page): Promise<ViewerStop | null> {
	const link = page.locator(PHOTO_LINK).first();
	if ((await link.count()) === 0) return 'no-photo-link';
	await link.click({ timeout: 8000 }).catch(() => {});
	await page.waitForSelector(VIEWER_SIGNS, { timeout: 8000 }).catch(() => {});
	if (isLoginAddress(page)) return 'login';
	return (await page.locator(VIEWER_SIGNS).count()) > 0 ? null : 'viewer-not-opened';
}

/** Waits (briefly) until the viewer shows a photo whose file name is not `previous`. */
async function waitForAnother(page: Page, previous: string): Promise<ViewerPhoto | null> {
	for (let i = 0; i < 40; i++) {
		const photo = await currentPhoto(page);
		if (photo && pictureName(photo.url) !== previous) return photo;
		await page.waitForTimeout(150);
	}
	return null;
}

export async function walkFacebookViewer(page: Page, options: ViewerOptions): Promise<{ photos: ViewerPhoto[]; stopped: ViewerStop }> {
	const photos: ViewerPhoto[] = [];
	const seen = new Set<string>();
	const keep = (photo: ViewerPhoto) => {
		seen.add(pictureName(photo.url));
		photos.push({ ...photo, alt: NO_DESCRIPTION.test(photo.alt.trim()) ? '' : photo.alt });
	};

	await dismissLoginSuggestion(page);
	const failed = await openViewer(page);
	if (failed) return { photos, stopped: failed };

	let photo = await waitForAnother(page, '');
	if (!photo) return { photos, stopped: 'viewer-not-opened' };
	keep(photo);

	for (;;) {
		if (photos.length >= options.maxPhotos) return { photos, stopped: 'limit' };
		if (Date.now() > options.stopAt) return { photos, stopped: 'out-of-time' };
		if (isLoginAddress(page)) return { photos, stopped: 'login' };
		const next = page.locator(NEXT).first();
		if ((await next.count()) === 0) return { photos, stopped: 'last' };

		await page.waitForTimeout(options.pauseMs);
		const before = pictureName(photo.url);
		await next.click({ timeout: 5000 }).catch(() => {});
		const another = await waitForAnother(page, before);
		if (isLoginAddress(page)) return { photos, stopped: 'login' };
		if (!another) return { photos, stopped: 'stuck' };
		if (seen.has(pictureName(another.url))) return { photos, stopped: 'cycle' };
		photo = another;
		keep(photo);
	}
}

/** A sentence for the administrator about how the walk ended. */
export function describeWalk(count: number, stopped: ViewerStop): string {
	const read = `Opened Facebook's photo viewer and read ${count} photo${count === 1 ? '' : 's'}.`;
	switch (stopped) {
		case 'last':
		case 'cycle':
			return read;
		case 'limit':
			return `${read} Stopped at the limit of ${count}.`;
		case 'login':
			return `${read} Facebook then asked for a login, so the rest could not be read (Picweb does not sign in).`;
		case 'stuck':
			return `${read} The viewer did not move on to another photo, so it stopped there.`;
		case 'out-of-time':
			return `${read} Stopped because it was taking too long.`;
		case 'no-photo-link':
			return 'The post has no photo to open in the viewer, so only what the page itself shows was read.';
		case 'viewer-not-opened':
			return 'Facebook did not open its photo viewer, so only what the post page itself shows (smaller pictures) was read.';
	}
}
