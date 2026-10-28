import type { APIRoute } from 'astro';
import { db } from '../../../server/db.ts';
import { cleanAvatar, cleanName, readJson, AVATAR_MAX_CHARS } from '../../../server/validate.ts';
import { json, rejectCrossSite, requireUser } from '../../../server/admin-api.ts';
import { toPublic } from '../../../server/accounts.ts';
import { releaseAvatars, storeAvatar } from '../../../server/avatars.ts';
import { getStorage } from '../../../server/storage.ts';

export const prerender = false;

// The signed-in user's own name and avatar. The id always comes from the session, never from the request,
// so nobody can change another person's profile through here.
export const PUT: APIRoute = async ({ request }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;
	const user = requireUser(request);
	if (user instanceof Response) return user;

	const body = await readJson(request, AVATAR_MAX_CHARS + 4096);
	if (!body) return json({ error: 'Invalid request.' }, 400);
	const firstName = cleanName(body.firstName);
	const lastName = cleanName(body.lastName);
	if (!firstName || !lastName) return json({ error: 'Enter your first and last name.' }, 400);
	// The avatar is one of: nothing (removed), the one the account already has (unchanged), or a new picture sent as a data URL.
	// A new picture goes to the photo storage (Cloudflare R2) and the account keeps its address; with no storage set up it stays
	// a data URL, as before. An address of any other kind is refused, so nobody can point an avatar at someone else's site.
	let avatar: string | null;
	if (body.avatar === null || body.avatar === '') avatar = null;
	else if (typeof body.avatar === 'string' && body.avatar === user.avatar) avatar = user.avatar;
	else {
		const data = cleanAvatar(body.avatar);
		if (typeof data !== 'string') return json({ error: 'The picture must be a PNG, JPEG or WebP image of reasonable size.' }, 400);
		if (getStorage()) {
			const stored = await storeAvatar(data);
			if (!stored.ok) return json({ error: stored.error }, stored.status);
			avatar = stored.url;
		} else {
			avatar = data;
		}
	}

	db().prepare('UPDATE users SET first_name = ?, last_name = ?, avatar = ? WHERE id = ?').run(firstName, lastName, avatar, user.id);
	// The picture this one replaced (or that was removed) is deleted from the storage unless another account still uses it.
	if (user.avatar !== avatar) await releaseAvatars([user.avatar]);
	return json({ user: toPublic({ ...user, firstName, lastName, avatar }) });
};
