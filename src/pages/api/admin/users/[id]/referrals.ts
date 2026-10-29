import type { APIRoute } from 'astro';
import { userDetail } from '../../../../../server/credits.ts';
import { json, rejectCrossOrigin, requireAdmin } from '../../../../../server/admin-api.ts';

export const prerender = false;

// What the User management page shows when an administrator opens a user: the accounts that registered through the user's
// referral link and the user's credit history. Read-only, administrators only.
export const GET: APIRoute = async ({ params, request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectCrossOrigin(request);
	if (rejected) return rejected;

	const id = params.id ?? '';
	if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return json({ error: 'User not found.' }, 404);
	const detail = userDetail(id);
	if (!detail) return json({ error: 'User not found.' }, 404);
	return json(detail);
};
