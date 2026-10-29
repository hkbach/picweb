import { createHash, randomBytes } from 'node:crypto';
import { db, transaction } from './db.ts';

// Website traffic for the admin "Traffic" page, counted without cookies and without keeping anyone's address.
//  - A page VIEW is one page opened (admin pages are not counted).
//  - A VISIT is one person on one day: the first view of the day from an address and browser counts as a visit. The person
//    is recognised by a hash of address + browser + a random "salt" that is replaced every day, so a visitor cannot be
//    followed from one day to the next, and the hashes of past days are deleted. Only daily totals per country are kept.
// Days are UTC days, like the User management summary.

export const RANGES = [30, 90, 180, 365] as const;
export type Range = (typeof RANGES)[number];

const dayOf = (date = new Date()) => date.toISOString().slice(0, 10);
const shift = (day: string, by: number) => dayOf(new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000));

let current: { day: string; salt: string } | null = null;

// The salt of today: kept in the settings so a restart during the day does not count everyone again. When the day
// changes the old salt is replaced and yesterday's hashes are deleted.
function saltFor(day: string): string {
	if (current?.day === day) return current.salt;
	const stored = db().prepare("SELECT value FROM settings WHERE key = 'analytics.salt'").get() as { value: string } | undefined;
	let saved: { day?: string; salt?: string } = {};
	try {
		saved = stored ? JSON.parse(stored.value) : {};
	} catch {
		saved = {};
	}
	if (saved.day === day && typeof saved.salt === 'string') {
		current = { day, salt: saved.salt };
	} else {
		current = { day, salt: randomBytes(32).toString('hex') };
		db().prepare("INSERT INTO settings (key, value) VALUES ('analytics.salt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(current));
		db().prepare('DELETE FROM site_visitors WHERE day < ?').run(day);
	}
	return current.salt;
}

/** Counts one page view (and a visit, the first time today for this address + browser). */
export function recordView(ip: string, userAgent: string, country: string) {
	const day = dayOf();
	const visitor = createHash('sha256').update(`${saltFor(day)}|${ip}|${userAgent}`).digest('hex').slice(0, 32);
	transaction(() => {
		const isNew = Number(db().prepare('INSERT OR IGNORE INTO site_visitors (day, visitor) VALUES (?, ?)').run(day, visitor).changes) === 1;
		db()
			.prepare('INSERT INTO site_traffic (day, country, views, visitors) VALUES (?, ?, 1, ?) ON CONFLICT(day, country) DO UPDATE SET views = views + 1, visitors = visitors + excluded.visitors')
			.run(day, country, isNew ? 1 : 0);
	});
}

export interface TrafficReport {
	days: Range;
	from: string;
	to: string;
	/** One entry per day of the range, oldest first (days without traffic are 0). */
	series: Array<{ day: string; views: number; visits: number }>;
	totals: { views: number; visits: number };
	/** The same length of time just before the range; `covered` is false when the records do not go back that far. */
	previous: { views: number; visits: number; covered: boolean };
	today: { views: number; visits: number };
	/** Most visits first. "ZZ" means the country is not known. */
	countries: Array<{ code: string; views: number; visits: number }>;
}

export function trafficReport(days: Range): TrafficReport {
	const to = dayOf();
	const from = shift(to, -(days - 1));
	const prevFrom = shift(from, -days);
	const prevTo = shift(from, -1);
	const sum = (a: string, b: string) => db().prepare('SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(visitors), 0) AS visits FROM site_traffic WHERE day BETWEEN ? AND ?').get(a, b) as { views: number; visits: number };

	const rows = db().prepare('SELECT day, SUM(views) AS views, SUM(visitors) AS visits FROM site_traffic WHERE day BETWEEN ? AND ? GROUP BY day').all(from, to) as unknown as Array<{ day: string; views: number; visits: number }>;
	const byDay = new Map(rows.map((r) => [r.day, r]));
	const series = Array.from({ length: days }, (_, i) => {
		const day = shift(from, i);
		const r = byDay.get(day);
		return { day, views: r?.views ?? 0, visits: r?.visits ?? 0 };
	});
	const earliest = (db().prepare('SELECT MIN(day) AS day FROM site_traffic').get() as { day: string | null }).day;
	const countries = db()
		.prepare('SELECT country AS code, SUM(views) AS views, SUM(visitors) AS visits FROM site_traffic WHERE day BETWEEN ? AND ? GROUP BY country ORDER BY visits DESC, views DESC, country')
		.all(from, to) as unknown as TrafficReport['countries'];
	const today = sum(to, to);
	return {
		days,
		from,
		to,
		series,
		totals: sum(from, to),
		previous: { ...sum(prevFrom, prevTo), covered: earliest !== null && earliest <= prevFrom },
		today,
		countries,
	};
}
