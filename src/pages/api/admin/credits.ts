import type { APIRoute } from 'astro';
import { CREDIT_DEFAULTS, CREDIT_LIMITS, creditTotals, getCreditSettings, parseCreditSettings, saveCreditSettings } from '../../../server/credits.ts';
import { readJson } from '../../../server/validate.ts';
import { json, rejectCrossOrigin, rejectUnlessSameOriginJson, requireAdmin } from '../../../server/admin-api.ts';

export const prerender = false;

// The credit amounts of the referral programme (Users → Referral credits). A change applies to what happens afterwards;
// credits already given are not recalculated.
export const GET: APIRoute = async ({ request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectCrossOrigin(request);
	if (rejected) return rejected;
	return json({ settings: getCreditSettings(), defaults: CREDIT_DEFAULTS, limits: CREDIT_LIMITS, totals: creditTotals() });
};

export const PUT: APIRoute = async ({ request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	const parsed = parseCreditSettings(await readJson(request));
	if (!parsed.ok) return json({ error: parsed.error }, 400);
	saveCreditSettings(admin.id, parsed.value);
	return json({ settings: getCreditSettings(), totals: creditTotals() });
};
