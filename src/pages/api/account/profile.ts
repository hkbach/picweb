import type { APIRoute } from 'astro';
import { db } from '../../../server/db.ts';
import { cleanAvatar, cleanName, readJson, AVATAR_MAX_CHARS } from '../../../server/validate.ts';
import { json, rejectCrossSite, requireUser } from '../../../server/admin-api.ts';
import { toPublic } from '../../../server/accounts.ts';

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
	const avatar = cleanAvatar(body.avatar);
	if (avatar === undefined) return json({ error: 'The picture must be a PNG, JPEG or WebP image of reasonable size.' }, 400);

	db().prepare('UPDATE users SET first_name = ?, last_name = ?, avatar = ? WHERE id = ?').run(firstName, lastName, avatar, user.id);
	return json({ user: toPublic({ ...user, firstName, lastName, avatar }) });
};
