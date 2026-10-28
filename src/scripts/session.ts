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
