// Pictures on Facebook's picture hosts (fbcdn.net) are served from signed addresses that stop working at a time
// written in the address itself: the "oe" parameter, a hexadecimal Unix time in seconds. An album that only keeps
// such addresses (it did not download the pictures) shows broken pictures after that time.

/** When the address stops working (milliseconds since 1970), or null if it is not a Facebook picture address with an expiry. */
export function facebookExpiry(url: string): number | null {
	try {
		const u = new URL(url);
		if (!/(^|\.)fbcdn\.net$/i.test(u.hostname)) return null;
		const oe = u.searchParams.get('oe');
		if (!oe || !/^[0-9a-f]{1,8}$/i.test(oe)) return null;
		const ms = parseInt(oe, 16) * 1000;
		// Only believable dates (2015 to 2100): anything else is not an expiry.
		return ms > Date.UTC(2015, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : null;
	} catch {
		return null;
	}
}

const DAY = 86_400_000;

/** "1 Nov 2026" */
export const formatExpiry = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "in 4 days", "tomorrow", "today", or "already" when it has passed. */
export function untilExpiry(ms: number, now = Date.now()): string {
	if (ms <= now) return 'already';
	const days = Math.ceil((ms - now) / DAY);
	return days <= 1 ? 'within a day' : `in ${days} days`;
}
