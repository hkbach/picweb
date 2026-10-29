// Tells the server a page of the site was opened, for the admin Traffic page. Only the path is sent (no cookie is set and
// nothing is stored in the browser); the admin area is not counted.
const path = window.location.pathname;
if (path !== '/admin' && !path.startsWith('/admin/')) {
	fetch('/api/track', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ path }),
		credentials: 'same-origin',
		keepalive: true,
	}).catch(() => {});
}
