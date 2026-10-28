import type { APIRoute } from 'astro';
import { db } from '../../../../../server/db.ts';
import { audit } from '../../../../../server/audit.ts';
import { readJson } from '../../../../../server/validate.ts';
import { json, rejectUnlessSameOriginJson, requireAdmin } from '../../../../../server/admin-api.ts';

export const prerender = false;

// Activates or deactivates an album. A deactivated album disappears from the public site (Homepage, album popup,
// sitemap, visitors' likes and favorites) but keeps all its data, and can be activated again at any time.
export const PUT: APIRoute = async ({ params, request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	const id = Number(params.id);
	const album = Number.isInteger(id) ? (db().prepare('SELECT id, status FROM albums WHERE id = ?').get(id) as { id: number; status: string } | undefined) : undefined;
	if (!album) return json({ error: 'Album not found.' }, 404);

	const body = await readJson(request);
	const status = body?.status;
	if (status !== 'active' && status !== 'deactivated') return json({ error: 'The status must be "active" or "deactivated".' }, 400);

	if (album.status !== status) {
		db().prepare('UPDATE albums SET status = ? WHERE id = ?').run(status, id);
		audit(admin.id, status === 'active' ? 'album.activate' : 'album.deactivate', String(id));
	}
	return json({ ok: true, status });
};
