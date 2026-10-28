import type { APIRoute } from 'astro';
import { db, transaction } from '../../../server/db.ts';
import { audit } from '../../../server/audit.ts';
import { readJson } from '../../../server/validate.ts';
import { json, rejectCrossOrigin, requireAdmin } from '../../../server/admin-api.ts';

export const prerender = false;

const MAX_CATEGORIES = 30;
const MAX_NAME = 30;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Replaces the whole list. The array order is the order of the Homepage navigation bar.
export const PUT: APIRoute = async ({ request }) => {
	const crossOrigin = rejectCrossOrigin(request);
	if (crossOrigin) return crossOrigin;
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;

	const body = await readJson(request);
	const list = body?.categories;
	if (!Array.isArray(list) || list.length > MAX_CATEGORIES) return json({ error: `Send at most ${MAX_CATEGORIES} categories.` }, 400);

	const seenIds = new Set<string>();
	const seenNames = new Set<string>();
	const clean: Array<{ id: string; name: string }> = [];
	for (const item of list) {
		const id = typeof item?.id === 'string' ? item.id : '';
		const name = typeof item?.name === 'string' ? item.name.trim().replace(/\s+/g, ' ') : '';
		if (!ID.test(id) || name.length < 1 || name.length > MAX_NAME || /^~|[\u0000-\u001f<>]/.test(name)) return json({ error: 'A category has an invalid name.' }, 400);
		if (seenIds.has(id) || seenNames.has(name.toLowerCase())) return json({ error: `The name "${name}" is used twice.` }, 400);
		seenIds.add(id);
		seenNames.add(name.toLowerCase());
		clean.push({ id, name });
	}

	transaction(() => {
		const before = (db().prepare('SELECT id FROM categories').all() as Array<{ id: string }>).map((r) => r.id);
		// Names are unique, and a rename can swap two names, so park every name first.
		db().prepare("UPDATE categories SET name = '~' || id").run();
		for (const id of before) if (!seenIds.has(id)) db().prepare('DELETE FROM categories WHERE id = ?').run(id);
		const upsert = db().prepare('INSERT INTO categories (id, name, position) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position');
		clean.forEach((c, position) => upsert.run(c.id, c.name, position));
		audit(admin.id, 'categories.save', undefined, `${clean.length} categories, ${before.filter((id) => !seenIds.has(id)).length} removed`);
	});
	return json({ ok: true });
};
