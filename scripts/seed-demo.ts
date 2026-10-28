import { randomUUID } from 'node:crypto';
import { db, transaction } from '../src/server/db.ts';
import { categories } from '../src/data/categories.ts';
import { users } from '../src/data/users.ts';
import { albums } from '../src/data/albums.ts';
import { fullPhotoUrl, photoUrl } from '../src/data/photos.ts';

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

	// Sample albums made of pictures from picsum.photos (public placeholders), nothing of anyone's.
	if (count('albums') === 0) {
		const album = db().prepare('INSERT INTO albums (title, type, created_at) VALUES (?, ?, ?)');
		const photo = db().prepare('INSERT INTO photos (album_id, position, url, thumb_url, alt, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)');
		const category = db().prepare('INSERT OR IGNORE INTO album_categories (album_id, category_id) SELECT ?, id FROM categories WHERE id = ?');
		for (const a of albums) {
			const albumId = Number(album.run(a.title, a.type, new Date().toISOString()).lastInsertRowid);
			let cover = 0;
			a.photos.forEach((p, i) => {
				const id = Number(photo.run(albumId, i, fullPhotoUrl(p), photoUrl(p), p.alt, p.width, p.height).lastInsertRowid);
				if (p.id === a.cover.id) cover = id;
			});
			db().prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ?').run(cover, albumId);
			for (const id of a.categoryIds) category.run(albumId, id);
		}
		console.log(`Added ${albums.length} sample albums with ${albums.reduce((n, a) => n + a.photos.length, 0)} photos.`);
	} else console.log('Albums already exist: skipped.');
});
