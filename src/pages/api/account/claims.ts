import type { APIRoute } from 'astro';
import { balanceOf } from '../../../server/credits.ts';
import { createClaim, listClaimsOf } from '../../../server/claims.ts';
import { allow } from '../../../server/limits.ts';
import { readJson } from '../../../server/validate.ts';
import { json, rejectCrossSite, requireUser } from '../../../server/admin-api.ts';

export const prerender = false;

// The signed-in user cashes out their credits through PayPal. The user always comes from the session, and the amount is
// worked out on the server from the balance and the current rate: the request carries only the PayPal address.
export const POST: APIRoute = async ({ request }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;
	const user = requireUser(request);
	if (user instanceof Response) return user;
	// Generous, so typing mistakes never lock anyone out: this only stops a script. The real limit is on claims made (createClaim).
	if (!allow(`claim-try:${user.id}`, 40, 60 * 60 * 1000)) return json({ error: 'Too many attempts. Try again later.' }, 429);

	const body = await readJson(request);
	if (!body) return json({ error: 'Invalid request.' }, 400);
	const result = createClaim(user, body.paypal);
	if (!result.ok) return json({ error: result.error }, result.status);
	return json({ claim: result.claim, claims: listClaimsOf(user.id), balance: balanceOf(user.id) }, 201);
};
