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
