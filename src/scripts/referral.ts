// An invitation link looks like https://site/?ref=abcde12345. The code is kept in this browser until the visitor
// registers, then it is sent along with the sign-up (see auth-api.ts) and forgotten. Nothing else is stored.
const KEY = 'picweb_ref';
const CODE = /^[a-z0-9]{6,16}$/i;

const read = (): string | null => {
	try {
		const value = localStorage.getItem(KEY);
		return value && CODE.test(value) ? value.toLowerCase() : null;
	} catch {
		return null;
	}
};

export const storedRef = read;

export const forgetRef = () => {
	try {
		localStorage.removeItem(KEY);
	} catch {
		// storage blocked: nothing was kept
	}
};

// Landing with ?ref=… remembers the code (the latest link wins) and tidies the address bar.
const url = new URL(window.location.href);
const code = url.searchParams.get('ref');
if (code !== null) {
	if (CODE.test(code)) {
		try {
			localStorage.setItem(KEY, code.toLowerCase());
		} catch {
			// storage blocked: the friend can still sign up, only without the invitation
		}
	}
	url.searchParams.delete('ref');
	history.replaceState(null, '', url.pathname + url.search + url.hash);
}
