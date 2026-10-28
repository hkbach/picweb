import { createHash } from 'node:crypto';
import { sniffImage } from '../../crawler/download-image.ts';
import { db } from './db.ts';
import { AVATAR_KEY, getStorage, MEDIA_TYPES, StorageError } from './storage.ts';

// Avatars. When photo storage is set up (Cloudflare R2), a picture a user chooses is stored there under
// `avatars/<hash>.<type>` and the account keeps only its address. Without storage the avatar stays a small data URL in the
// database, as before. Two users who pick the same picture share one object, so it is only deleted when nobody uses it.

const MAX_BYTES = 1024 * 1024; // the page shrinks avatars to 256 px (a few KB); this only stops abuse
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/;

export type AvatarResult = { ok: true; url: string } | { ok: false; status: number; error: string };

/** Stores a picture sent as a data URL in the photo storage, and returns the address it is shown from. */
export async function storeAvatar(dataUrl: string): Promise<AvatarResult> {
	const storage = getStorage();
	if (!storage) return { ok: false, status: 501, error: 'Photo storage is not set up on this server.' };
	const match = DATA_URL.exec(dataUrl);
	if (!match) return { ok: false, status: 400, error: 'The picture must be a PNG, JPEG or WebP image of reasonable size.' };
	const bytes = Buffer.from(match[2], 'base64');
	if (bytes.length === 0 || bytes.length > MAX_BYTES) return { ok: false, status: 400, error: 'The picture is too large. Choose a smaller one.' };
	// What the bytes really are decides, not what the text says (a GIF, an SVG or a text file is refused).
	const type = sniffImage(bytes);
	if (type !== 'jpg' && type !== 'png' && type !== 'webp') return { ok: false, status: 400, error: 'The picture must be a PNG, JPEG or WebP image of reasonable size.' };
	const key = `avatars/${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${type}`;
	try {
		return { ok: true, url: await storage.put(key, bytes, MEDIA_TYPES[type]) };
	} catch (error) {
		return { ok: false, status: 502, error: error instanceof StorageError ? error.message : 'The picture could not be stored. Nothing was changed.' };
	}
}

/** The storage key an avatar address points to, or null if it is not one of ours (a data URL, or nothing). */
export function avatarKeyOf(url: string | null): string | null {
	if (!url) return null;
	const key = /(avatars\/[a-f0-9]{32}\.(?:jpg|png|webp))$/.exec(url)?.[1];
	if (!key || !AVATAR_KEY.test(key)) return null;
	const storage = getStorage();
	return storage && storage.publicUrl(key) === url ? key : null;
}

/**
 * Deletes the stored pictures behind avatar addresses nobody uses any more (call after the change was saved). A failure
 * leaves a stray object in the bucket, which costs nothing noticeable, so it never stops what the person was doing.
 */
export async function releaseAvatars(urls: Array<string | null>): Promise<void> {
	const storage = getStorage();
	if (!storage) return;
	for (const url of new Set(urls)) {
		const key = avatarKeyOf(url);
		if (!key || db().prepare('SELECT 1 FROM users WHERE avatar = ? LIMIT 1').get(url)) continue;
		try {
			await storage.remove(key);
		} catch {
			// left in the bucket
		}
	}
}
