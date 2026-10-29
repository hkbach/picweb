import type { APIRoute } from 'astro';
import { allow } from '../../server/limits.ts';
import { clientIp } from '../../server/client-ip.ts';
import { countryOf } from '../../server/geo.ts';
import { recordView } from '../../server/traffic.ts';
import { readJson } from '../../server/validate.ts';
import { rejectCrossSite } from '../../server/admin-api.ts';

export const prerender = false;

// A page of the site was opened (sent by src/scripts/track.ts). Counted for the admin Traffic page; see server/traffic.ts
// for what is (and is not) kept. Pages of the admin area and requests from known robots are not counted.
const ROBOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|curl|wget|python-requests/i;

const done = (status = 204) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
	const crossSite = rejectCrossSite(request);
	if (crossSite) return crossSite;
	const body = await readJson(request, 2048);
	const path = typeof body?.path === 'string' ? body.path : '';
	if (!path.startsWith('/') || path.length > 500) return done(400);
	if (path === '/admin' || path.startsWith('/admin/')) return done();

	const userAgent = request.headers.get('user-agent') ?? '';
	if (!userAgent || ROBOT.test(userAgent)) return done();
	const ip = clientIp(request, clientAddress);
	if (!allow(`track:${ip}`, 120, 60_000)) return done(429);
	recordView(ip, userAgent, countryOf(request, ip));
	return done();
};
