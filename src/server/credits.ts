import { randomBytes } from 'node:crypto';
import { db, transaction } from './db.ts';
import { audit } from './audit.ts';

// Credits and invitations.
//  - A user earns SIGNUP credits when they register.
//  - A user who invites a friend earns REFERRAL_SIGNUP credits when that friend registers through their link.
//  - And REFERRAL_ALBUMS credits each time that friend has opened another `albumsPerCredit` different albums.
// The amounts are set by an administrator (Users → Referral credits). A credit is a row in credit_ledger, and a balance is
// the sum of a user's rows. A change of amounts affects only what happens afterwards.

export interface CreditSettings {
	/** Credits for the person who registers. */
	signup: number;
	/** Credits for the inviter when an invited friend registers. */
	referralSignup: number;
	/** Credits for the inviter each time the friend has opened another `albumsPerCredit` albums. */
	referralAlbums: number;
	/** How many different albums the friend opens for one such grant. */
	albumsPerCredit: number;
	/** Cash-out rate: this many credits are worth 1 USD. */
	creditsPerUsd: number;
}

export const CREDIT_DEFAULTS: CreditSettings = { signup: 10, referralSignup: 0, referralAlbums: 1, albumsPerCredit: 5, creditsPerUsd: 100 };
export const CREDIT_LIMITS = { points: { min: 0, max: 1000 }, albumsPerCredit: { min: 1, max: 100 }, creditsPerUsd: { min: 1, max: 100000 } };

const KEYS: Record<keyof CreditSettings, string> = {
	signup: 'credits.signup',
	referralSignup: 'credits.referral_signup',
	referralAlbums: 'credits.referral_albums',
	albumsPerCredit: 'credits.albums_per_credit',
	creditsPerUsd: 'credits.credits_per_usd',
};

const limitsOf = (field: keyof CreditSettings) => (field === 'albumsPerCredit' ? CREDIT_LIMITS.albumsPerCredit : field === 'creditsPerUsd' ? CREDIT_LIMITS.creditsPerUsd : CREDIT_LIMITS.points);

const inRange = (field: keyof CreditSettings, n: number) => {
	const { min, max } = limitsOf(field);
	return Number.isInteger(n) && n >= min && n <= max;
};

export function getCreditSettings(): CreditSettings {
	const rows = db().prepare("SELECT key, value FROM settings WHERE key LIKE 'credits.%'").all() as unknown as Array<{ key: string; value: string }>;
	const stored = new Map(rows.map((r) => [r.key, Number(r.value)]));
	const result = { ...CREDIT_DEFAULTS };
	for (const field of Object.keys(KEYS) as Array<keyof CreditSettings>) {
		const value = stored.get(KEYS[field]);
		if (value !== undefined && inRange(field, value)) result[field] = value;
	}
	return result;
}

const LABELS: Record<keyof CreditSettings, string> = {
	signup: 'Credits for registering',
	referralSignup: 'Credits when an invited friend registers',
	referralAlbums: 'Credits for each batch of albums the friend opens',
	albumsPerCredit: 'Albums in one batch',
	creditsPerUsd: 'Credits worth 1 USD',
};

/** Checks what an administrator sent; every field is required and must be a whole number in range. */
export function parseCreditSettings(body: Record<string, unknown> | null): { ok: true; value: CreditSettings } | { ok: false; error: string } {
	if (!body) return { ok: false, error: 'Invalid request.' };
	const value = { ...CREDIT_DEFAULTS };
	for (const field of Object.keys(KEYS) as Array<keyof CreditSettings>) {
		const n = body[field];
		const { min, max } = limitsOf(field);
		if (typeof n !== 'number' || !inRange(field, n)) return { ok: false, error: `${LABELS[field]}: enter a whole number from ${min} to ${max}.` };
		value[field] = n;
	}
	return { ok: true, value };
}

export function saveCreditSettings(actorId: string, value: CreditSettings) {
	transaction(() => {
		const upsert = db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
		for (const field of Object.keys(KEYS) as Array<keyof CreditSettings>) upsert.run(KEYS[field], String(value[field]));
		audit(actorId, 'credits.settings', undefined, `signup ${value.signup}, friend signup ${value.referralSignup}, ${value.referralAlbums} per ${value.albumsPerCredit} albums, ${value.creditsPerUsd} credits per USD`);
	});
}

// ---- invitation codes

export function newReferralCode(): string {
	for (;;) {
		const code = randomBytes(5).toString('hex');
		if (!db().prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code)) return code;
	}
}

/** The code of a user, made on first use for accounts that were created without one (by an administrator, or a script). */
export function ensureReferralCode(userId: string): string {
	const row = db().prepare('SELECT referral_code FROM users WHERE id = ?').get(userId) as { referral_code: string | null } | undefined;
	if (row?.referral_code) return row.referral_code;
	const code = newReferralCode();
	db().prepare('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL').run(code, userId);
	return (db().prepare('SELECT referral_code FROM users WHERE id = ?').get(userId) as { referral_code: string }).referral_code;
}

/** The user a code belongs to, or null (also for text that cannot be a code). */
export function findInviter(code: string): string | null {
	if (!/^[a-z0-9]{6,16}$/i.test(code)) return null;
	const row = db().prepare('SELECT id FROM users WHERE referral_code = ?').get(code.toLowerCase()) as { id: string } | undefined;
	return row?.id ?? null;
}

// ---- granting credits (call inside a transaction)

const grant = (userId: string, amount: number, reason: 'signup' | 'referral_signup' | 'referral_albums', sourceUserId: string | null) =>
	db().prepare('INSERT INTO credit_ledger (user_id, amount, reason, source_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, amount, reason, sourceUserId, new Date().toISOString());

/** The credits for a new account: the sign-up credits, and the inviter's credits when they were invited. Amounts of 0 leave no row. */
export function registerCredits(userId: string, inviterId: string | null) {
	const settings = getCreditSettings();
	if (settings.signup > 0) grant(userId, settings.signup, 'signup', null);
	if (inviterId && settings.referralSignup > 0) grant(inviterId, settings.referralSignup, 'referral_signup', userId);
}

/**
 * A signed-in user was shown an album. If they were invited, each different album counts once; every time the count
 * reaches another multiple of `albumsPerCredit`, the person who invited them is granted the credits. (A grant is written
 * even when the amount is 0, so raising the amount later does not pay back what happened before.)
 */
export function recordAlbumOpen(userId: string, albumId: number) {
	const me = db().prepare('SELECT referred_by FROM users WHERE id = ?').get(userId) as { referred_by: string | null } | undefined;
	if (!me?.referred_by) return;
	const inviter = me.referred_by;
	transaction(() => {
		const added = db().prepare('INSERT OR IGNORE INTO album_opens (user_id, album_id, created_at) VALUES (?, ?, ?)').run(userId, albumId, new Date().toISOString());
		if (Number(added.changes) === 0) return;
		const settings = getCreditSettings();
		const opened = (db().prepare('SELECT COUNT(*) AS n FROM album_opens WHERE user_id = ?').get(userId) as { n: number }).n;
		const steps = Math.floor(opened / settings.albumsPerCredit);
		const done = (db().prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE reason = 'referral_albums' AND user_id = ? AND source_user_id = ?").get(inviter, userId) as { n: number }).n;
		for (let i = done; i < steps; i++) grant(inviter, settings.referralAlbums, 'referral_albums', userId);
	});
}

/** The user opened their Referrals page: the Home page stops telling them about the rewards. */
export const markReferralsSeen = (userId: string) => {
	db().prepare('UPDATE users SET referrals_notice = 0 WHERE id = ? AND referrals_notice = 1').run(userId);
};

// ---- what the pages show

export const balanceOf = (userId: string): number => (db().prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_ledger WHERE user_id = ?').get(userId) as { n: number }).n;

/**
 * An invited account as its inviter sees it. The inviter is a different person from the friend, so the friend is only
 * partly shown: first name and the initial of the last name, and an email with its middle hidden ("b***@gmail.com").
 */
export interface Friend {
	name: string;
	email: string;
	joinedAt: string;
	/** Different albums the friend has opened. */
	opened: number;
	/** Credits this friend has earned the inviter so far. */
	earned: number;
}

export const maskEmail = (email: string): string => {
	const at = email.lastIndexOf('@');
	return at <= 0 ? '***' : `${email[0]}***${email.slice(at)}`;
};

export interface ReferralSummary {
	code: string;
	balance: number;
	settings: CreditSettings;
	/** The accounts that signed up through this user's link, newest first (at most 200 are listed), and how many there are in all. */
	friends: Friend[];
	friendCount: number;
	history: Array<{ amount: number; reason: 'signup' | 'referral_signup' | 'referral_albums' | 'claim' | 'claim_refund' | 'admin_grant'; at: string }>;
}

export function referralSummary(userId: string): ReferralSummary {
	const rows = db()
		.prepare(
			`SELECT u.first_name, u.last_name, u.email, u.created_at,
			        (SELECT COUNT(*) FROM album_opens o WHERE o.user_id = u.id) AS opened,
			        (SELECT COALESCE(SUM(l.amount), 0) FROM credit_ledger l WHERE l.user_id = ? AND l.source_user_id = u.id AND l.reason IN ('referral_signup', 'referral_albums')) AS earned
			 FROM users u WHERE u.referred_by = ? ORDER BY u.created_at DESC, u.id DESC LIMIT 200`,
		)
		.all(userId, userId) as unknown as Array<{ first_name: string; last_name: string; email: string; created_at: string; opened: number; earned: number }>;
	const friends: Friend[] = rows.map((r) => ({
		name: `${r.first_name} ${r.last_name.trim().charAt(0).toUpperCase()}.`.trim(),
		email: maskEmail(r.email),
		joinedAt: r.created_at,
		opened: r.opened,
		earned: r.earned,
	}));
	const friendCount = (db().prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').get(userId) as { n: number }).n;
	const history = db()
		.prepare('SELECT amount, reason, created_at FROM credit_ledger WHERE user_id = ? AND amount <> 0 ORDER BY id DESC LIMIT 100')
		.all(userId) as unknown as Array<{ amount: number; reason: ReferralSummary['history'][number]['reason']; created_at: string }>;
	return { code: ensureReferralCode(userId), balance: balanceOf(userId), settings: getCreditSettings(), friends, friendCount, history: history.map((h) => ({ amount: h.amount, reason: h.reason, at: h.created_at })) };
}

export interface UserDetail {
	user: { id: string; name: string; email: string; role: 'user' | 'admin'; status: 'active' | 'deactivated'; referralCode: string | null; balance: number; invitedBy: { name: string; email: string } | null };
	/** Everyone who registered through this user's link, newest first (an administrator sees them in full). */
	friends: Array<{ name: string; email: string; status: 'active' | 'deactivated'; joinedAt: string; opened: number; earned: number }>;
	/** Every credit movement of the user, newest first, each with a sentence saying what it was. */
	history: Array<{ amount: number; label: string; at: string }>;
	/** True when more than the limit exist and the lists were cut. */
	truncated: boolean;
}

const DETAIL_LIMIT = 1000;
const fullName = (first: string, last: string) => `${first} ${last}`.trim();

/** What an administrator sees when opening a user: their referral accounts and their credit history. Null if there is no such user. */
export function userDetail(userId: string): UserDetail | null {
	const u = db().prepare('SELECT id, first_name, last_name, email, role, status, referral_code, referred_by FROM users WHERE id = ?').get(userId) as
		| { id: string; first_name: string; last_name: string; email: string; role: 'user' | 'admin'; status: 'active' | 'deactivated'; referral_code: string | null; referred_by: string | null }
		| undefined;
	if (!u) return null;
	const inviter = u.referred_by ? (db().prepare('SELECT first_name, last_name, email FROM users WHERE id = ?').get(u.referred_by) as { first_name: string; last_name: string; email: string } | undefined) : undefined;
	const friends = db()
		.prepare(
			`SELECT f.first_name, f.last_name, f.email, f.status, f.created_at,
			        (SELECT COUNT(*) FROM album_opens o WHERE o.user_id = f.id) AS opened,
			        (SELECT COALESCE(SUM(l.amount), 0) FROM credit_ledger l WHERE l.user_id = ? AND l.source_user_id = f.id AND l.reason IN ('referral_signup', 'referral_albums')) AS earned
			 FROM users f WHERE f.referred_by = ? ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
		)
		.all(userId, userId, DETAIL_LIMIT + 1) as unknown as Array<{ first_name: string; last_name: string; email: string; status: 'active' | 'deactivated'; created_at: string; opened: number; earned: number }>;
	const rows = db()
		.prepare(
			`SELECT l.amount, l.reason, l.created_at, f.first_name, f.last_name, f.email, c.usd_cents
			 FROM credit_ledger l
			 LEFT JOIN users f ON f.id = l.source_user_id
			 LEFT JOIN credit_claims c ON c.id = l.claim_id
			 WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ?`,
		)
		.all(userId, DETAIL_LIMIT + 1) as unknown as Array<{ amount: number; reason: string; created_at: string; first_name: string | null; last_name: string | null; email: string | null; usd_cents: number | null }>;
	const who = (r: { first_name: string | null; last_name: string | null; email: string | null }) => (r.email ? `${fullName(r.first_name ?? '', r.last_name ?? '')} (${r.email})` : 'a deleted account');
	const labelOf = (r: (typeof rows)[number]) => {
		switch (r.reason) {
			case 'signup':
				return 'Credits for registering';
			case 'referral_signup':
				return `A friend registered through the link: ${who(r)}`;
			case 'referral_albums':
				return `${who(r)} opened more albums${r.amount === 0 ? ' (worth 0 credits at the time)' : ''}`;
			case 'claim':
				return `Claimed ${r.usd_cents === null ? '' : `$${(r.usd_cents / 100).toFixed(2)} `}through PayPal`;
			case 'claim_refund':
				return 'A claim was rejected: the credits were returned';
			case 'admin_grant':
				return 'Added by an administrator';
			default:
				return r.reason;
		}
	};
	return {
		user: { id: u.id, name: fullName(u.first_name, u.last_name), email: u.email, role: u.role, status: u.status, referralCode: u.referral_code, balance: balanceOf(u.id), invitedBy: inviter ? { name: fullName(inviter.first_name, inviter.last_name), email: inviter.email } : null },
		friends: friends.slice(0, DETAIL_LIMIT).map((f) => ({ name: fullName(f.first_name, f.last_name), email: f.email, status: f.status, joinedAt: f.created_at, opened: f.opened, earned: f.earned })),
		history: rows.slice(0, DETAIL_LIMIT).map((r) => ({ amount: r.amount, label: labelOf(r), at: r.created_at })),
		truncated: friends.length > DETAIL_LIMIT || rows.length > DETAIL_LIMIT,
	};
}

/** Figures for the administrator's page. */
export function creditTotals() {
	return {
		creditsGiven: (db().prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_ledger').get() as { n: number }).n,
		invitedUsers: (db().prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL').get() as { n: number }).n,
	};
}
