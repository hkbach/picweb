import { session } from './session';

// Like / add to collection / download, on the photo cards and in the album popup. Guests get the login popup
// instead. For a signed-in user a click is sent to the server (/api/photos/<id>/like or /favorite), which
// stores it under the account; the buttons show what the server has.
const root = document.documentElement;
const liked = new Set<number>();
const favorites = new Set<number>();

// A button belongs to the photo card it sits in, or to the photo currently shown in the album popup.
const photoIdOf = (el: Element): number | null => {
	const id = el.closest<HTMLElement>('[data-photo-id]')?.dataset.photoId ?? el.closest<HTMLElement>('#album-modal')?.dataset.photoId;
	return id ? Number(id) : null;
};

const GLYPHS = { like: ['♡', '♥', 'Like', 'Unlike'], favorite: ['＋', '✓', 'Add to collection', 'Remove from collection'] } as const;

const paint = () => {
	document.querySelectorAll<HTMLElement>('[data-action="like"], [data-action="favorite"]').forEach((el) => {
		const id = photoIdOf(el);
		if (id === null) return;
		const action = el.dataset.action as 'like' | 'favorite';
		const on = (action === 'like' ? liked : favorites).has(id);
		const [off, onGlyph, offTitle, onTitle] = GLYPHS[action];
		el.setAttribute('aria-pressed', String(on));
		el.textContent = on ? onGlyph : off;
		el.title = on ? onTitle : offTitle;
		el.setAttribute('aria-label', on ? onTitle : offTitle);
	});
};

const openLogin = () => document.querySelector<HTMLElement>('[data-open-login]')?.click();

// The address of a photo, read from the data the album popup already carries.
const sourceOf = (photoId: number): string | null => {
	try {
		const data = JSON.parse(document.querySelector('#album-data')?.textContent ?? '{}') as { albums: Record<string, { photos: Array<{ id: number; src: string }> }> };
		for (const album of Object.values(data.albums)) {
			const photo = album.photos.find((p) => p.id === photoId);
			if (photo) return photo.src;
		}
	} catch {
		// no data on this page
	}
	return null;
};

const download = (photoId: number) => {
	const src = sourceOf(photoId);
	if (!src) return;
	const url = new URL(src, window.location.href);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
	// Another site's picture cannot be saved by the "download" attribute, so it opens in a new tab instead.
	const link = document.createElement('a');
	link.href = url.href;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.download = '';
	link.click();
};

document.addEventListener('click', async (e) => {
	const control = (e.target as HTMLElement).closest<HTMLElement>('[data-requires-login]');
	if (!control) return;
	e.preventDefault();
	if (root.dataset.auth === 'guest') return openLogin();

	const id = photoIdOf(control);
	const action = control.dataset.action;
	if (id === null) return;
	if (action === 'download') return download(id);
	if (action !== 'like' && action !== 'favorite') return;

	const set = action === 'like' ? liked : favorites;
	const turnOn = !set.has(id);
	// Shown straight away, and put back if the server does not accept it.
	if (turnOn) set.add(id);
	else set.delete(id);
	paint();
	let status = 0;
	try {
		status = (await fetch(`/api/photos/${id}/${action}`, { method: turnOn ? 'PUT' : 'DELETE', credentials: 'same-origin' })).status;
	} catch {
		// offline: handled below
	}
	if (status >= 200 && status < 300) return;
	if (turnOn) set.delete(id);
	else set.add(id);
	paint();
	if (status === 401) {
		// The session ended while the page was open.
		root.dataset.auth = 'guest';
		openLogin();
	}
});

// When the album popup moves to another photo, its buttons must show that photo's state.
document.addEventListener('album:photo', paint);

session.then(async (user) => {
	if (!user) return;
	try {
		const response = await fetch('/api/account/state', { credentials: 'same-origin' });
		if (!response.ok) return;
		const state = (await response.json()) as { liked: number[]; favorites: number[] };
		state.liked.forEach((id) => liked.add(id));
		state.favorites.forEach((id) => favorites.add(id));
		paint();
	} catch {
		// the buttons simply stay unmarked
	}
});
