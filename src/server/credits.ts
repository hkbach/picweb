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
}

export const CREDIT_DEFAULTS: CreditSettings = { signup: 10, referralSignup: 0, referralAlbums: 1, albumsPerCredit: 5 };
export const CREDIT_LIMITS = { points: { min: 0, max: 1000 }, albumsPerCredit: { min: 1, max: 100 } };

const KEYS: Record<keyof CreditSettings, string> = {
	signup: 'credits.signup',
	referralSignup: 'credits.referral_signup',
	referralAlbums: 'credits.referral_albums',
	albumsPerCredit: 'credits.albums_per_credit',
};

const inRange = (field: keyof CreditSettings, n: number) => {
	const { min, max } = field === 'albumsPerCredit' ? CREDIT_LIMITS.albumsPerCredit : CREDIT_LIMITS.points;
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
};

/** Checks what an administrator sent; every field is required and must be a whole number in range. */
export function parseCreditSettings(body: Record<string, unknown> | null): { ok: true; value: CreditSettings } | { ok: false; error: string } {
	if (!body) return { ok: false, error: 'Invalid request.' };
	const value = { ...CREDIT_DEFAULTS };
	for (const field of Object.keys(KEYS) as Array<keyof CreditSettings>) {
		const n = body[field];
		const { min, max } = field === 'albumsPerCredit' ? CREDIT_LIMITS.albumsPerCredit : CREDIT_LIMITS.points;
		if (typeof n !== 'number' || !inRange(field, n)) return { ok: false, error: `${LABELS[field]}: enter a whole number from ${min} to ${max}.` };
		value[field] = n;
	}
	return { ok: true, value };
}

export function saveCreditSettings(actorId: string, value: CreditSettings) {
	transaction(() => {
		const upsert = db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
		for (const field of Object.keys(KEYS) as Array<keyof CreditSettings>) upsert.run(KEYS[field], String(value[field]));
		audit(actorId, 'credits.settings', undefined, `signup ${value.signup}, friend signup ${value.referralSignup}, ${value.referralAlbums} per ${value.albumsPerCredit} albums`);
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

// ---- what the pages show

export const balanceOf = (userId: string): number => (db().prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_ledger WHERE user_id = ?').get(userId) as { n: number }).n;

export interface ReferralSummary {
	code: string;
	balance: number;
	settings: CreditSettings;
	/** The people who signed up through this user's link, oldest first: only how far each has got (no names). */
	friends: Array<{ opened: number }>;
	history: Array<{ amount: number; reason: 'signup' | 'referral_signup' | 'referral_albums'; at: string }>;
}

export function referralSummary(userId: string): ReferralSummary {
	const friends = db()
		.prepare('SELECT (SELECT COUNT(*) FROM album_opens o WHERE o.user_id = u.id) AS opened FROM users u WHERE u.referred_by = ? ORDER BY u.created_at, u.id')
		.all(userId) as unknown as Array<{ opened: number }>;
	const history = db()
		.prepare('SELECT amount, reason, created_at FROM credit_ledger WHERE user_id = ? AND amount <> 0 ORDER BY id DESC LIMIT 100')
		.all(userId) as unknown as Array<{ amount: number; reason: ReferralSummary['history'][number]['reason']; created_at: string }>;
	return { code: ensureReferralCode(userId), balance: balanceOf(userId), settings: getCreditSettings(), friends, history: history.map((h) => ({ amount: h.amount, reason: h.reason, at: h.created_at })) };
}

/** Figures for the administrator's page. */
export function creditTotals() {
	return {
		creditsGiven: (db().prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM credit_ledger').get() as { n: number }).n,
		invitedUsers: (db().prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL').get() as { n: number }).n,
	};
}
