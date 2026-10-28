import type { APIRoute } from 'astro';
import { AVATAR_KEY, MEDIA_TYPES, readLocal, storageDriver } from '../../../../server/storage.ts';

// Serves avatars kept by the "local" storage driver (with Cloudflare R2 they are served from the bucket's own address).
// Only names this server generated are opened, so no path can reach outside the uploads folder.
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const key = `avatars/${params.key ?? ''}`;
	if (storageDriver() !== 'local' || !AVATAR_KEY.test(key)) return new Response('Not found', { status: 404 });
	const file = await readLocal(key);
	if (!file) return new Response('Not found', { status: 404 });
	return new Response(new Uint8Array(file), {
		headers: {
			'content-type': MEDIA_TYPES[key.split('.').pop()!],
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
		},
	});
};
