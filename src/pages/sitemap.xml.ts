import type { APIRoute } from 'astro';
import { listAlbums, listCategories } from '../server/repo.ts';
import { siteUrl, xmlEscape } from '../server/site.ts';

export const prerender = false;

// The Homepage, and each category that has at least one album (the first category is the Homepage itself, so it is
// not listed twice). The address of the site comes from SITE_URL; without it there is nothing correct to write.
export const GET: APIRoute = ({ request }) => {
	const site = siteUrl(request);
	if (!site) return new Response('SITE_URL is not set, so the sitemap cannot be written.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

	const albums = listAlbums().filter((a) => a.status === 'active'); // a deactivated album is not shown, so it counts for nothing
	const rest = listCategories().slice(1);
	const urls = [`${site}/`];
	for (const category of rest) if (albums.some((a) => a.categoryIds.includes(category.id))) urls.push(`${site}/?category=${encodeURIComponent(category.id)}`);

	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `\t<url><loc>${xmlEscape(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
	return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
