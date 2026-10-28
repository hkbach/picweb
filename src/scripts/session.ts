import { fetchMe } from './auth-api';
import { applyProfile } from './profile-store';

// Pages are built ahead of time, so the page itself cannot know who is looking at it. This asks the
// server once and sets data-auth on <html>, which the stylesheets use to show Login or Account.
// It is only a display matter: every action is checked again on the server.
const root = document.documentElement;

export const session = fetchMe().then((user) => {
	root.dataset.auth = user ? 'user' : 'guest';
	root.dataset.role = user?.role ?? '';
	if (user) applyProfile(user);
	document.dispatchEvent(new CustomEvent('session:ready', { detail: { user } }));
	return user;
});

// Visitors who are not signed in cannot open the right-click menu (which includes "Save image as" and "Open image in
// new tab"). Text fields are left alone so pasting into the login form still works. This is a deterrent for casual
// saving only: it cannot stop someone who uses the browser's developer tools, a screenshot or the network log.
// data-auth starts as "guest" on public pages, so the menu is also blocked until the server says who is there.
const touchScreen = window.matchMedia('(pointer: coarse), (hover: none)');
document.addEventListener('contextmenu', (event) => {
	const target = event.target as HTMLElement | null;
	if (target?.closest('input, textarea, [contenteditable="true"]')) return;
	// On a touch screen, pressing and holding a public picture raises this event (it is what opens "Save image"):
	// nobody gets it there, signed in or not.
	if (touchScreen.matches && target?.closest('[data-no-save], img')) {
		event.preventDefault();
		return;
	}
	if (root.dataset.auth === 'user') return;
	event.preventDefault();
});
// Touch screens can also drag a picture out of the page (to Photos or Files): not from public pictures.
document.addEventListener('dragstart', (event) => {
	if (touchScreen.matches && (event.target as HTMLElement | null)?.closest('[data-no-save]')) event.preventDefault();
});

