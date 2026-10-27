import type { APIRoute } from 'astro';
import { crawlImages, parseTargetUrl } from '../../../../crawler/crawl-images.ts';
import { adminApiEnabled, json, rejectUnlessSameOriginJson } from '../../../server/admin-api.ts';

// Runs on the server on demand; the rest of the site stays static.
export const prerender = false;

// This endpoint opens a real browser on any URL it is given, so it is locked down:
//  - disabled unless running `astro dev` or CRAWL_API_ENABLED=true is set explicitly,
//  - allowed host names and same-origin JSON requests only (blocks cross-site forms, scripts and DNS rebinding),
//  - one crawl at a time, with fixed limits that the client cannot raise.
// There is still NO authentication: do not expose this to the internet until admin login exists.
const LIMITS = { maxImages: 300, timeoutMs: 30_000, minSize: 400 };

let busy = false;

export const POST: APIRoute = async ({ request }) => {
	if (!adminApiEnabled) return json({ error: 'Crawling is disabled on this server.' }, 403);
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	let target: string;
	try {
		const body = await request.json();
		target = typeof body?.url === 'string' ? body.url : '';
		parseTargetUrl(target); // rejects non-http(s), malformed URLs and embedded credentials
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Invalid request.' }, 400);
	}

	if (busy) return json({ error: 'Another crawl is already running. Try again in a moment.' }, 429);
	busy = true;
	try {
		return json(await crawlImages(target, LIMITS));
	} catch (error) {
		// The first line is the useful part; Playwright appends a long call log.
		const message = error instanceof Error ? error.message.split('\n')[0] : 'Crawl failed.';
		return json({ error: `Crawl failed: ${message}` }, 502);
	} finally {
		busy = false;
	}
};
