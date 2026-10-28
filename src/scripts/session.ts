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
document.addEventListener('contextmenu', (event) => {
	if (root.dataset.auth === 'user') return;
	const target = event.target as HTMLElement | null;
	if (target?.closest('input, textarea, [contenteditable="true"]')) return;
	event.preventDefault();
});

