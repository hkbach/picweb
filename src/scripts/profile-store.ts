// Shows the signed-in user's name and avatar. The data comes from the account service
// (/api/auth/me and /api/account/profile); nothing about the profile is kept in browser storage.
export interface Profile {
	firstName: string;
	lastName: string;
	avatar: string | null; // data:image/... URL
}

// Updates every name and avatar on the page: [data-user-name] and [data-user-avatar].
export function applyProfile(profile: Profile) {
	const name = `${profile.firstName} ${profile.lastName}`.trim();
	document.querySelectorAll<HTMLElement>('[data-user-name]').forEach((el) => {
		el.textContent = name;
	});
	document.querySelectorAll<HTMLElement>('[data-user-avatar]').forEach((el) => {
		// Only an image the server accepted (see cleanAvatar) is ever put into a style.
		if (profile.avatar && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(profile.avatar)) {
			el.style.backgroundImage = `url("${profile.avatar}")`;
			el.textContent = '';
		} else {
			el.style.backgroundImage = '';
			el.textContent = (profile.firstName[0] ?? '?').toUpperCase();
		}
	});
}
