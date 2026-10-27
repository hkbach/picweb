export type UserStatus = 'active' | 'deactivated';

export interface User {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	status: UserStatus;
	/** Registration day as YYYY-MM-DD (UTC). */
	registeredAt: string;
}

// Placeholder data, generated the same way every time. The names are invented and every email uses
// example.com, a domain reserved for examples, so none of it belongs to a real person.
// A real user service replaces this; the Admin > Users page then reads from it instead.
const DAY = 86_400_000;
const now = new Date();
const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/** The day the sample data runs up to. Charts count back from here. */
export const snapshotDate = new Date(todayMs).toISOString().slice(0, 10);

// Small seeded random generator (mulberry32) so the sample users do not change between builds.
function seeded(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = seeded(20240607);
const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];

// Number of sign-ups on one day: Poisson-distributed around `lambda`.
function poisson(lambda: number) {
	const limit = Math.exp(-lambda);
	let k = 0;
	let p = 1;
	do {
		k++;
		p *= rand();
	} while (p > limit);
	return k - 1;
}

const firstNames = ['Linh', 'Minh', 'Hoang', 'Thu', 'Quoc', 'Mai', 'Anh', 'Bao', 'Chi', 'Dung', 'Hanh', 'Khanh', 'Lan', 'Nam', 'Phuc', 'Quynh', 'Son', 'Trang', 'Vy', 'Yen', 'An', 'Duc', 'Giang', 'Huy'];
const lastNames = ['Tran', 'Nguyen', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui', 'Do', 'Ngo', 'Duong', 'Ly', 'Phan', 'Truong', 'Dinh', 'Mai'];

const HISTORY_DAYS = 400; // a little more than a year, so the 1-year chart is full
const seenEmails = new Map<string, number>();

export const users: User[] = [];
for (let daysAgo = HISTORY_DAYS - 1; daysAgo >= 0; daysAgo--) {
	const day = new Date(todayMs - daysAgo * DAY);
	const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
	// Sign-ups grow over the period and dip at weekends.
	const lambda = (0.35 + 1.3 * (1 - daysAgo / HISTORY_DAYS)) * (weekend ? 0.6 : 1);
	for (let n = poisson(lambda); n > 0; n--) {
		const firstName = pick(firstNames);
		const lastName = pick(lastNames);
		const base = `${firstName}.${lastName}`.toLowerCase();
		const count = (seenEmails.get(base) ?? 0) + 1;
		seenEmails.set(base, count);
		users.push({
			id: `u${users.length + 1}`,
			firstName,
			lastName,
			email: `${base}${count > 1 ? count : ''}@example.com`,
			status: rand() < 0.12 ? 'deactivated' : 'active',
			registeredAt: day.toISOString().slice(0, 10),
		});
	}
}
