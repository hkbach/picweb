// Checks for what visitors send. The browser forms check the same things only to help the person typing;
// these are the checks that count.
export const EMAIL_MAX = 254;
export const NAME_MAX = 50;
export const AVATAR_MAX_CHARS = 400_000;

export const cleanEmail = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const email = value.trim().toLowerCase();
	return email.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};

export const cleanName = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const name = value.trim().replace(/\s+/g, ' ');
	return name.length >= 1 && name.length <= NAME_MAX && !/[\u0000-\u001f<>]/.test(name) ? name : null;
};

/** A PNG, JPEG or WebP picture as a data URL; anything else (SVG can carry scripts) is refused. */
export const cleanAvatar = (value: unknown): string | null | undefined => {
	if (value === null || value === '') return null;
	if (typeof value !== 'string' || value.length > AVATAR_MAX_CHARS) return undefined;
	return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : undefined;
};

/** Reads a JSON body of limited size; returns null when it is missing, too large or not an object. */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) return null;
	try {
		const text = await request.text();
		if (text.length > maxBytes) return null;
		const body = JSON.parse(text);
		return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
	} catch {
		return null;
	}
}
