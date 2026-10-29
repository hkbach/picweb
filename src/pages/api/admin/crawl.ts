import type { APIRoute } from 'astro';
import { CrawlError, crawlImages, parseFacebookUrl, parseTargetUrl, type CrawlSource } from '../../../../crawler/crawl-images.ts';
import { adminApiEnabled, json, rejectUnlessSameOriginJson, requireAdmin } from '../../../server/admin-api.ts';
import { readJson } from '../../../server/validate.ts';

// Runs on the server on demand; the rest of the site stays static.
export const prerender = false;

// This endpoint opens a real browser on any URL it is given, so it is locked down:
//  - disabled unless running `astro dev` or CRAWL_API_ENABLED=true is set explicitly,
//  - an administrator's session, an allowed host name and a same-origin JSON request (blocks cross-site forms, scripts and DNS rebinding),
//  - one crawl at a time, with fixed limits that the client cannot raise.
const LIMITS = { maxImages: 300, timeoutMs: 30_000, minSize: 400 };

const FACEBOOK_TOTAL_MS = 180_000;

let busy = false;

export const POST: APIRoute = async ({ request }) => {
	if (!adminApiEnabled) return json({ error: 'Crawling is disabled on this server.' }, 403);
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	let target: string;
	let source: CrawlSource = 'web';
	try {
		const body = await readJson(request);
		if (!body) throw new Error('Invalid request.');
		target = typeof body?.url === 'string' ? body.url : '';
		if (body?.source !== undefined && body.source !== 'web' && body.source !== 'facebook') return json({ error: 'Unknown source.' }, 400);
		source = body?.source === 'facebook' ? 'facebook' : 'web';
		// Rejects non-http(s), malformed URLs and embedded credentials (and, for Facebook, any other site).
		if (source === 'facebook') parseFacebookUrl(target);
		else parseTargetUrl(target);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Invalid request.' }, 400);
	}

	if (busy) return json({ error: 'Another crawl is already running. Try again in a moment.' }, 429);
	busy = true;
	try {
		// Going through a post's photos one by one takes longer than reading a page.
		return json(await crawlImages(target, { ...LIMITS, source, ...(source === 'facebook' ? { totalTimeoutMs: FACEBOOK_TOTAL_MS } : {}) }));
	} catch (error) {
		// The first line is the useful part; Playwright appends a long call log.
		const message = error instanceof Error ? error.message.split('\n')[0] : 'Crawl failed.';
		// Our own messages (Facebook asks for a login, ...) are shown as they are.
		return json({ error: error instanceof CrawlError ? message : `Crawl failed: ${message}` }, 502);
	} finally {
		busy = false;
	}
};
