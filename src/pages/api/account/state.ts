import type { APIRoute } from 'astro';
import { reactionState } from '../../../server/repo.ts';
import { json, requireUser } from '../../../server/admin-api.ts';

export const prerender = false;

// Which photos the signed-in user has liked or added to favorites, so the pages can mark the buttons.
export const GET: APIRoute = async ({ request }) => {
	const user = requireUser(request);
	if (user instanceof Response) return user;
	return json(reactionState(user.id));
};
