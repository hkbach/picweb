import { randomUUID } from 'node:crypto';
import { db, transaction } from '../src/server/db.ts';
import { categories } from '../src/data/categories.ts';
import { users } from '../src/data/users.ts';

// DEVELOPMENT ONLY. Fills an EMPTY database with the made-up sample data the site was designed with, so the
// pages have something to show. Never run it against a real database: it only fills tables that are empty,
// but the people it adds are invented. The sample users have no password, so none of them can sign in.
//   npm run seed:demo
const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

transaction(() => {
	if (count('categories') === 0) {
		const insert = db().prepare('INSERT INTO categories (id, name, position) VALUES (?, ?, ?)');
		categories.forEach((c, position) => insert.run(c.id, c.name, position));
		console.log(`Added ${categories.length} categories.`);
	} else console.log('Categories already exist: skipped.');

	// The administrator (if one was created) counts as a user, so "empty" means no one except administrators.
	if ((db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get() as { n: number }).n === 0) {
		const insert = db().prepare("INSERT INTO users (id, first_name, last_name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, '!', 'user', ?, ?)");
		for (const u of users) insert.run(randomUUID(), u.firstName, u.lastName, u.email, u.status, `${u.registeredAt}T12:00:00.000Z`);
		console.log(`Added ${users.length} sample users.`);
	} else console.log('Users already exist: skipped.');
});
