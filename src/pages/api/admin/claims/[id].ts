import type { APIRoute } from 'astro';
import { CLAIM_STATUSES, setClaimStatus, type ClaimStatus } from '../../../../server/claims.ts';
import { readJson } from '../../../../server/validate.ts';
import { json, rejectUnlessSameOriginJson, requireAdmin } from '../../../../server/admin-api.ts';

export const prerender = false;

// An administrator changes the status of a claim after paying (or refusing) it. Rejecting returns the credits to the user.
export const PATCH: APIRoute = async ({ params, request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	const id = Number(params.id);
	if (!Number.isInteger(id)) return json({ error: 'Claim not found.' }, 404);
	const body = await readJson(request);
	const status = body?.status;
	if (typeof status !== 'string' || !CLAIM_STATUSES.includes(status as ClaimStatus)) return json({ error: 'Choose a status: processing, paid or rejected.' }, 400);
	const result = setClaimStatus(admin.id, id, status as ClaimStatus);
	if (!result.ok) return json({ error: result.error }, result.status);
	return json({ claim: result.claim });
};
