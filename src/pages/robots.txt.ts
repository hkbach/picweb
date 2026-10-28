import type { APIRoute } from 'astro';
import { siteUrl } from '../server/site.ts';

export const prerender = false;

// Tells search engines what to leave alone. Pictures served from /api/media (uploads) stay allowed so they can be
// found and shown; everything else under /api, and the admin and account areas, are not for crawlers.
export const GET: APIRoute = ({ request }) => {
	const site = siteUrl(request);
	const lines = ['User-agent: *', 'Disallow: /admin/', 'Disallow: /account/', 'Disallow: /api/', 'Allow: /api/media/'];
	if (site) lines.push('', `Sitemap: ${site}/sitemap.xml`);
	return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
