// Client-side profile storage. There is no backend yet, so the profile lives in this browser's
// localStorage only; swap these functions for API calls when an account service exists.
export interface Profile {
	firstName: string;
	lastName: string;
	avatar: string | null; // data:image/... URL produced by the profile page
}

const KEY = 'picweb:profile';

export function readProfile(): Profile | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const p = JSON.parse(raw);
		if (typeof p?.firstName !== 'string' || typeof p?.lastName !== 'string') return null;
		const avatar = typeof p.avatar === 'string' && p.avatar.startsWith('data:image/') ? p.avatar : null;
		return { firstName: p.firstName, lastName: p.lastName, avatar };
	} catch {
		return null;
	}
}

export function writeProfile(profile: Profile): boolean {
	try {
		localStorage.setItem(KEY, JSON.stringify(profile));
		return true;
	} catch {
		return false;
	}
}

// Updates every name and avatar on the page: [data-user-name] and [data-user-avatar].
export function applyProfile(profile: Profile) {
	const name = `${profile.firstName} ${profile.lastName}`.trim();
	document.querySelectorAll<HTMLElement>('[data-user-name]').forEach((el) => {
		el.textContent = name;
	});
	document.querySelectorAll<HTMLElement>('[data-user-avatar]').forEach((el) => {
		if (profile.avatar) {
			el.style.backgroundImage = `url("${profile.avatar}")`;
			el.textContent = '';
		} else {
			el.style.backgroundImage = '';
			el.textContent = (profile.firstName[0] ?? '?').toUpperCase();
		}
	});
}
