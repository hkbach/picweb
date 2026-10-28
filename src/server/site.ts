import './env.ts';

// The public address of this site, used for canonical links, Open Graph addresses, robots.txt and sitemap.xml.
//
// Set SITE_URL (for example https://picweb.example.com) in production. It is NOT taken from the request there: a
// request's Host header can be forged, and a forged address would end up in pages that search engines and other
// users' browsers keep. Under `astro dev` the request's own address is used, so nothing has to be configured.
export function siteUrl(request: Request): string | null {
	const configured = process.env.SITE_URL?.trim();
	if (configured) {
		try {
			const url = new URL(configured);
			if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
		} catch {
			// not a valid address: treated as not set
		}
		return null;
	}
	return import.meta.env.DEV ? new URL(request.url).origin : null;
}

export const SITE_NAME = 'Picweb';
/** The default description of a page (50 to 160 characters is what search results show in full). */
export const SITE_DESCRIPTION = 'Browse albums of free high-resolution photos shared by creators on Picweb. Pick a category, then open an album to see every photo.';

const XML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' };

/** Escapes text for use inside XML (sitemap.xml). */
export const xmlEscape = (text: string) => text.replace(/[<>&"]/g, (c) => XML_ESCAPES[c]).replace(/'/g, '&apos;');
