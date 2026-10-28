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
