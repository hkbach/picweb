import './env.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// One SQLite file holds everything the site stores. It lives outside the web root and is never served.
// Where: DATA_DIR (default ./data next to where the server is started). Back this folder up; it is the
// only copy of the accounts. The folder is in .gitignore.
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));

// Each entry upgrades the database by one version, in order. Never edit an entry that has shipped:
// add a new one instead.
const MIGRATIONS: string[] = [
	`
	CREATE TABLE users (
		id TEXT PRIMARY KEY,
		first_name TEXT NOT NULL,
		last_name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE COLLATE NOCASE,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
		status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
		must_change_password INTEGER NOT NULL DEFAULT 0,
		avatar TEXT,
		created_at TEXT NOT NULL
	);
	-- Only the hash of a session token is stored, so a copy of the database cannot be used to sign in.
	CREATE TABLE sessions (
		token_hash TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL,
		expires_at TEXT NOT NULL
	);
	CREATE INDEX sessions_user ON sessions(user_id);
	`,
	`
	-- The list shown in the Homepage navigation bar, in order.
	CREATE TABLE categories (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE,
		position INTEGER NOT NULL
	);
	-- Who changed what, by id only (no names, emails or passwords are copied here).
	CREATE TABLE audit_log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		at TEXT NOT NULL,
		actor_id TEXT,
		action TEXT NOT NULL,
		target TEXT,
		detail TEXT
	);
	`,
	`
	CREATE TABLE albums (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		-- How it was made: from image links (crawling) or from files (uploaded).
		type TEXT NOT NULL CHECK (type IN ('crawling', 'uploaded')),
		-- The photo shown as the album's thumbnail. Always one of the album's own photos (checked in code).
		cover_photo_id INTEGER,
		created_at TEXT NOT NULL
	);
	CREATE TABLE album_categories (
		album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
		PRIMARY KEY (album_id, category_id)
	);
	CREATE TABLE photos (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		position INTEGER NOT NULL,
		-- The full picture, and a smaller one for grids (null = use the full one).
		url TEXT NOT NULL,
		thumb_url TEXT,
		alt TEXT NOT NULL,
		width INTEGER NOT NULL,
		height INTEGER NOT NULL,
		-- Set for pictures this site stored itself (uploads); null for pictures that stay on another site.
		storage_key TEXT
	);
	CREATE INDEX photos_album ON photos(album_id, position);
	`,
	`
	-- A user's liked photos and their favorites ("Add to collection"). They go when the user or the photo goes.
	CREATE TABLE likes (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL,
		PRIMARY KEY (user_id, photo_id)
	);
	CREATE TABLE favorites (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL,
		PRIMARY KEY (user_id, photo_id)
	);
	`,
	`
	-- Every address an administrator crawled to collect an album's pictures, kept for tracking where they came from.
	-- It is a history: editing the album later does not change it, and it goes only when the album goes.
	CREATE TABLE album_sources (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		kind TEXT NOT NULL CHECK (kind IN ('web', 'facebook')),
		-- The address as the administrator typed it (the original), and where it led (a share link becomes the post).
		url TEXT NOT NULL,
		final_url TEXT,
		title TEXT,
		created_at TEXT NOT NULL
	);
	CREATE INDEX album_sources_album ON album_sources(album_id);
	CREATE INDEX album_sources_url ON album_sources(url);
	`,
	`
	-- An album that is deactivated is hidden from the whole public site (and from its visitors' likes and favorites) but
	-- keeps all its data. Only a deactivated album can be deleted. Albums that exist already stay active.
	ALTER TABLE albums ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated'));
	`,
	`
	-- Converting a link-based album into an uploaded one makes a copy: the copy remembers the album it came from, and the
	-- original (deactivated when the copy was finished) remembers the copy. Plain numbers, not links: deleting either
	-- album must not delete the other.
	ALTER TABLE albums ADD COLUMN converted_from INTEGER;
	ALTER TABLE albums ADD COLUMN converted_to INTEGER;
	`,
	`
	-- How many times each photo was opened in the album popup. Only a counter per photo: no visitor, address or time is
	-- stored. It goes when the photo goes.
	CREATE TABLE photo_views (
		photo_id INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
		views INTEGER NOT NULL DEFAULT 0
	);
	`,
	`
	-- Referrals and credits. Every user has a code for an invitation link; a user who signs up through a link remembers
	-- who invited them. Credits are never stored as a balance: the balance is the sum of the ledger, one row per grant.
	ALTER TABLE users ADD COLUMN referral_code TEXT;
	ALTER TABLE users ADD COLUMN referred_by TEXT REFERENCES users(id) ON DELETE SET NULL;
	UPDATE users SET referral_code = lower(hex(randomblob(5)));
	CREATE UNIQUE INDEX users_referral_code ON users(referral_code);
	-- Settings an administrator can change (the credit amounts); a missing row means the built-in default.
	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	CREATE TABLE credit_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		amount INTEGER NOT NULL,
		reason TEXT NOT NULL CHECK (reason IN ('signup', 'referral_signup', 'referral_albums')),
		-- the invited friend a credit came from (plain text: it stays if that account is deleted)
		source_user_id TEXT,
		created_at TEXT NOT NULL
	);
	CREATE INDEX credit_ledger_user ON credit_ledger(user_id);
	-- The albums a user has opened, once each: the invited friend's progress towards the next credit of the inviter.
	CREATE TABLE album_opens (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL,
		PRIMARY KEY (user_id, album_id)
	);
	`,
	`
	-- Cashing out credits. The ledger gets two more reasons (a claim takes credits out, a rejected claim puts them back) and
	-- a link to the claim; a CHECK cannot be changed in place, so the table is rebuilt with its rows.
	CREATE TABLE credit_ledger_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		amount INTEGER NOT NULL,
		reason TEXT NOT NULL CHECK (reason IN ('signup', 'referral_signup', 'referral_albums', 'claim', 'claim_refund')),
		source_user_id TEXT,
		created_at TEXT NOT NULL,
		claim_id INTEGER
	);
	INSERT INTO credit_ledger_new (id, user_id, amount, reason, source_user_id, created_at) SELECT id, user_id, amount, reason, source_user_id, created_at FROM credit_ledger;
	DROP TABLE credit_ledger;
	ALTER TABLE credit_ledger_new RENAME TO credit_ledger;
	CREATE INDEX credit_ledger_user ON credit_ledger(user_id);
	-- One row per request to cash out. The name and email are copied, and the user link is cleared if the account is deleted,
	-- so the record of what is owed or was paid survives. The PayPal address is only ever shown to its owner and to administrators.
	CREATE TABLE credit_claims (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
		user_name TEXT NOT NULL,
		user_email TEXT NOT NULL,
		credits INTEGER NOT NULL,
		-- the rate (credits per USD) and the amount, fixed when the claim was made
		rate INTEGER NOT NULL,
		usd_cents INTEGER NOT NULL,
		paypal TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'paid', 'rejected')),
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE INDEX credit_claims_user ON credit_claims(user_id);
	`,
	`
	-- Credits an administrator adds by hand get their own reason, so the history says what they are.
	CREATE TABLE credit_ledger_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		amount INTEGER NOT NULL,
		reason TEXT NOT NULL CHECK (reason IN ('signup', 'referral_signup', 'referral_albums', 'claim', 'claim_refund', 'admin_grant')),
		source_user_id TEXT,
		created_at TEXT NOT NULL,
		claim_id INTEGER
	);
	INSERT INTO credit_ledger_new (id, user_id, amount, reason, source_user_id, created_at, claim_id) SELECT id, user_id, amount, reason, source_user_id, created_at, claim_id FROM credit_ledger;
	DROP TABLE credit_ledger;
	ALTER TABLE credit_ledger_new RENAME TO credit_ledger;
	CREATE INDEX credit_ledger_user ON credit_ledger(user_id);
	`,
	`
	-- The Home page tells a newly registered user that they can earn rewards on the Referrals page. It stays up until that
	-- page is opened, on any browser or device, so it is kept here with the account (1 = still to show). Only a
	-- registration sets it: accounts that already exist, and ones an administrator creates, do not get the notice.
	ALTER TABLE users ADD COLUMN referrals_notice INTEGER NOT NULL DEFAULT 0;
	`,
	`
	-- How many albums an invited friend has opened since the last batch was paid to their inviter. Before, progress was
	-- worked out from the friend's lifetime count, so changing "albums per credit" paid many batches at once (or none for a
	-- long time). Existing friends start from what they had left over under the current setting (at most one batch short).
	CREATE TABLE referral_progress (
		friend_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		pending INTEGER NOT NULL DEFAULT 0
	);
	INSERT INTO referral_progress (friend_id, pending)
	SELECT u.id, MIN(n.per - 1, MAX(0,
		(SELECT COUNT(*) FROM album_opens o WHERE o.user_id = u.id)
		- (SELECT COUNT(*) FROM credit_ledger l WHERE l.reason = 'referral_albums' AND l.source_user_id = u.id AND l.user_id = u.referred_by) * n.per))
	FROM users u, (SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'credits.albums_per_credit'), 5) AS per) n
	WHERE u.referred_by IS NOT NULL;
	`,
	`
	-- Website traffic (the admin Traffic page): page views and visits per UTC day and country. No address, no cookie and
	-- nothing about a person is kept: site_visitors holds only today's salted hashes, to count each visitor once a day,
	-- and older ones are deleted when the day changes.
	CREATE TABLE site_traffic (
		day TEXT NOT NULL,
		country TEXT NOT NULL,
		views INTEGER NOT NULL DEFAULT 0,
		visitors INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (day, country)
	);
	CREATE TABLE site_visitors (
		day TEXT NOT NULL,
		visitor TEXT NOT NULL,
		PRIMARY KEY (day, visitor)
	);
	`,
];

type Db = DatabaseSync;

function open(): Db {
	mkdirSync(DATA_DIR, { recursive: true });
	const db = new DatabaseSync(path.join(DATA_DIR, 'picweb.db'));
	db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
	for (let version = current; version < MIGRATIONS.length; version++) {
		db.exec('BEGIN');
		try {
			db.exec(MIGRATIONS[version]);
			db.exec(`PRAGMA user_version = ${version + 1}`);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}
	return db;
}

// One connection per process, kept across dev-server reloads.
const holder = globalThis as typeof globalThis & { __picwebDb?: Db };
export const db = (): Db => (holder.__picwebDb ??= open());

/** Runs `work` as one all-or-nothing change. */
export function transaction<T>(work: () => T): T {
	const connection = db();
	connection.exec('BEGIN IMMEDIATE');
	try {
		const result = work();
		connection.exec('COMMIT');
		return result;
	} catch (error) {
		connection.exec('ROLLBACK');
		throw error;
	}
}
