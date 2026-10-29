import type { APIRoute } from 'astro';
import { RANGES, trafficReport, type Range } from '../../../server/traffic.ts';
import { geoSource } from '../../../server/geo.ts';
import { json, rejectCrossOrigin, requireAdmin } from '../../../server/admin-api.ts';

export const prerender = false;

// Page views and visits per day and per country for the admin Traffic page (?days=30, 90, 180 or 365).
export const GET: APIRoute = async ({ request, url }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectCrossOrigin(request);
	if (rejected) return rejected;
	const days = Number(url.searchParams.get('days') ?? 30);
	if (!(RANGES as readonly number[]).includes(days)) return json({ error: 'Choose 30, 90, 180 or 365 days.' }, 400);
	return json({ ...trafficReport(days as Range), geo: geoSource() });
};
