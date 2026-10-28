// Counts a view each time a photo is shown in the album popup (when it opens, and when the visitor moves to another
// photo). A photo is reported once per browser tab session, so flicking back and forth or reopening it does not count
// again. Nothing about the visitor is sent: only the photo's number.
const SEEN_KEY = 'picweb_viewed_photos';

const seen = (): Set<number> => {
	try {
		return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as number[]);
	} catch {
		return new Set();
	}
};
const remember = (ids: Set<number>) => {
	try {
		sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-500)));
	} catch {
		// storage blocked: the photo may be counted again next time, which is harmless
	}
};

document.addEventListener('album:photo', () => {
	const id = Number(document.querySelector<HTMLElement>('#album-modal')?.dataset.currentPhoto);
	if (!Number.isInteger(id) || id <= 0) return;
	const viewed = seen();
	if (viewed.has(id)) return;
	viewed.add(id);
	remember(viewed);
	// keepalive lets the request finish even if the page is left straight away; the answer is not needed.
	fetch(`/api/photos/${id}/view`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
});
