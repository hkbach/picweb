import type { APIRoute } from 'astro';
import { beginConversion } from '../../../../../server/convert.ts';
import { json, rejectUnlessSameOriginJson, requireAdmin } from '../../../../../server/admin-api.ts';

export const prerender = false;

// Converts an album made from image links into an uploaded album (see src/server/convert.ts). It can take minutes, so
// the answer is a stream of lines, each a small JSON object, that the page turns into a progress bar:
//   {"type":"start","total":12}  {"type":"progress","done":3,"total":12}  {"type":"saving"}
//   and finally {"type":"done",...} or {"type":"error",...}.
// If the browser goes away (Cancel, or the tab is closed) the conversion stops and nothing is created.
export const POST: APIRoute = async ({ params, request }) => {
	const admin = requireAdmin(request);
	if (admin instanceof Response) return admin;
	const rejected = rejectUnlessSameOriginJson(request);
	if (rejected) return rejected;

	const id = Number(params.id);
	if (!Number.isInteger(id)) return json({ error: 'Album not found.' }, 404);
	const started = beginConversion(id);
	if (!started.ok) return json({ error: started.error }, started.status);

	let cancelled = false;
	request.signal.addEventListener('abort', () => (cancelled = true));
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (line: object) => {
				try {
					controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
				} catch {
					cancelled = true; // nobody is listening any more
				}
			};
			try {
				const result = await started.run(admin.id, {
					onStart: (total) => send({ type: 'start', total }),
					onProgress: (done, total) => send({ type: 'progress', done, total }),
					onSaving: () => send({ type: 'saving' }),
					isCancelled: () => cancelled,
				});
				send(result.ok ? { type: 'done', newAlbumId: result.newAlbumId, photos: result.photos, stored: result.stored } : { type: 'error', error: result.error, failed: result.failed ?? [], cancelled: result.cancelled === true });
			} catch {
				send({ type: 'error', error: 'The album could not be converted. Nothing was changed.', failed: [], cancelled: false });
			}
			try {
				controller.close();
			} catch {
				// already closed
			}
		},
		cancel() {
			cancelled = true;
		},
	});
	return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
};
