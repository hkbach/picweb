import { db, transaction } from './db.ts';
import { audit } from './audit.ts';
import { balanceOf, getCreditSettings } from './credits.ts';
import type { SessionUser } from './sessions.ts';
import { cleanEmail } from './validate.ts';

// Cashing out credits through PayPal. A user may claim when their balance is worth at least 1 USD at the current rate
// (credits per USD, set by an administrator). A claim takes as many WHOLE dollars as the balance allows (100 credits per USD:
// 250 credits is a claim of 200 credits = 2 USD, and 50 stay), and the credits leave the balance straight away. The rate and
// the amount are written into the claim, so a later change of the rate does not change what was claimed.
// An administrator pays by hand and moves the claim through its statuses:
//   processing (new)  ->  paid          the money was sent
//   processing / paid ->  rejected      the credits go back to the user (once, and a rejected claim stays rejected)
// The PayPal address is never put in the audit log.

export type ClaimStatus = 'processing' | 'paid' | 'rejected';
export const CLAIM_STATUSES: ClaimStatus[] = ['processing', 'paid', 'rejected'];
export const CLAIM_LABELS: Record<ClaimStatus, string> = { processing: 'Processing', paid: 'Paid', rejected: 'Rejected' };

export interface Claim {
	id: number;
	userId: string | null;
	userName: string;
	userEmail: string;
	credits: number;
	rate: number;
	usdCents: number;
	paypal: string;
	status: ClaimStatus;
	createdAt: string;
	updatedAt: string;
}

interface Row {
	id: number;
	user_id: string | null;
	user_name: string;
	user_email: string;
	credits: number;
	rate: number;
	usd_cents: number;
	paypal: string;
	status: ClaimStatus;
	created_at: string;
	updated_at: string;
}

const view = (r: Row): Claim => ({ id: r.id, userId: r.user_id, userName: r.user_name, userEmail: r.user_email, credits: r.credits, rate: r.rate, usdCents: r.usd_cents, paypal: r.paypal, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** What a user could claim right now: whole dollars at the current rate, and the credits they cost. */
export function claimable(balance: number, rate: number) {
	const dollars = Math.floor(balance / rate);
	return { dollars, credits: dollars * rate };
}

export const listClaimsOf = (userId: string): Claim[] => (db().prepare('SELECT * FROM credit_claims WHERE user_id = ? ORDER BY id DESC').all(userId) as unknown as Row[]).map(view);

/** The latest claims first (an administrator's list; 500 is plenty for a hand-paid programme). */
export const listAllClaims = (): Claim[] => (db().prepare('SELECT * FROM credit_claims ORDER BY id DESC LIMIT 500').all() as unknown as Row[]).map(view);

/** At most this many claims made by one user in an hour (a failed attempt does not count). */
const CLAIMS_PER_HOUR = 5;

export type CreateResult = { ok: true; claim: Claim } | { ok: false; status: number; error: string };

export function createClaim(user: SessionUser, paypalInput: unknown): CreateResult {
	const paypal = cleanEmail(paypalInput);
	if (!paypal) return { ok: false, status: 400, error: 'Enter the email address of your PayPal account.' };
	// Balance and the claim are read and written in one transaction, so two requests at once cannot spend the same credits.
	return transaction((): CreateResult => {
		const recent = (db().prepare('SELECT COUNT(*) AS n FROM credit_claims WHERE user_id = ? AND created_at > ?').get(user.id, new Date(Date.now() - 60 * 60 * 1000).toISOString()) as { n: number }).n;
		if (recent >= CLAIMS_PER_HOUR) return { ok: false, status: 429, error: 'You have made several claims in the last hour. Try again later.' };
		const { creditsPerUsd } = getCreditSettings();
		const { dollars, credits } = claimable(balanceOf(user.id), creditsPerUsd);
		if (dollars < 1) return { ok: false, status: 409, error: `You need at least ${creditsPerUsd} credits to claim 1 USD.` };
		const at = new Date().toISOString();
		const name = `${user.firstName} ${user.lastName}`.trim();
		const result = db()
			.prepare('INSERT INTO credit_claims (user_id, user_name, user_email, credits, rate, usd_cents, paypal, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
			.run(user.id, name, user.email, credits, creditsPerUsd, dollars * 100, paypal, 'processing', at, at);
		const id = Number(result.lastInsertRowid);
		db().prepare("INSERT INTO credit_ledger (user_id, amount, reason, source_user_id, created_at, claim_id) VALUES (?, ?, 'claim', NULL, ?, ?)").run(user.id, -credits, at, id);
		audit(user.id, 'claim.create', String(id), `${credits} credits, ${usd(dollars * 100)}`);
		return { ok: true, claim: view(db().prepare('SELECT * FROM credit_claims WHERE id = ?').get(id) as unknown as Row) };
	});
}

export type StatusResult = { ok: true; claim: Claim } | { ok: false; status: number; error: string };

export function setClaimStatus(actorId: string, id: number, next: ClaimStatus): StatusResult {
	return transaction((): StatusResult => {
		const row = db().prepare('SELECT * FROM credit_claims WHERE id = ?').get(id) as unknown as Row | undefined;
		if (!row) return { ok: false, status: 404, error: 'Claim not found.' };
		if (row.status === next) return { ok: true, claim: view(row) };
		if (row.status === 'rejected') return { ok: false, status: 409, error: 'A rejected claim cannot be changed: its credits were already returned to the user.' };
		const at = new Date().toISOString();
		db().prepare('UPDATE credit_claims SET status = ?, updated_at = ? WHERE id = ?').run(next, at, id);
		// Rejecting gives the credits back (once: a rejected claim cannot move again). If the account is gone there is nobody to give them to.
		if (next === 'rejected' && row.user_id) db().prepare("INSERT INTO credit_ledger (user_id, amount, reason, source_user_id, created_at, claim_id) VALUES (?, ?, 'claim_refund', NULL, ?, ?)").run(row.user_id, row.credits, at, id);
		audit(actorId, 'claim.status', String(id), `${row.status} -> ${next}`);
		return { ok: true, claim: view(db().prepare('SELECT * FROM credit_claims WHERE id = ?').get(id) as unknown as Row) };
	});
}

export function claimTotals() {
	const rows = db().prepare('SELECT status, COUNT(*) AS n, COALESCE(SUM(usd_cents), 0) AS cents FROM credit_claims GROUP BY status').all() as unknown as Array<{ status: ClaimStatus; n: number; cents: number }>;
	const by = (s: ClaimStatus) => rows.find((r) => r.status === s) ?? { n: 0, cents: 0 };
	return { processing: by('processing'), paid: by('paid'), rejected: by('rejected') };
}
