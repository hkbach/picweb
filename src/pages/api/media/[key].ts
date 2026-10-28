import type { APIRoute } from 'astro';
import { MEDIA_KEY, MEDIA_TYPES, readLocal, storageDriver } from '../../../server/storage.ts';

// Serves pictures kept by the "local" storage driver. They are public (they appear on the public site), but only
// names this server generated are opened, so no path can reach outside the uploads folder.
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const key = params.key ?? '';
	if (storageDriver() !== 'local' || !MEDIA_KEY.test(key)) return new Response('Not found', { status: 404 });
	const file = await readLocal(key);
	if (!file) return new Response('Not found', { status: 404 });
	return new Response(new Uint8Array(file), {
		headers: {
			'content-type': MEDIA_TYPES[key.split('.').pop()!],
			// The name is a hash of the content, so the file behind it never changes.
			'cache-control': 'public, max-age=31536000, immutable',
			// Never let a browser guess a different type, and never run anything from this file.
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
		},
	});
};
