// Shows the signed-in user's name and avatar. The data comes from the account service
// (/api/auth/me and /api/account/profile); nothing about the profile is kept in browser storage.
export interface Profile {
	firstName: string;
	lastName: string;
	avatar: string | null; // an address on the photo storage, or (without storage) a data:image/... URL
}

const SAFE_AVATAR = /^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*|https?:\/\/[^\s"'()\\<>]+|\/api\/media\/avatars\/[a-f0-9]{32}\.(jpg|png|webp))$/;

// Updates every name and avatar on the page: [data-user-name] and [data-user-avatar].
export function applyProfile(profile: Profile) {
	const name = `${profile.firstName} ${profile.lastName}`.trim();
	document.querySelectorAll<HTMLElement>('[data-user-name]').forEach((el) => {
		el.textContent = name;
	});
	document.querySelectorAll<HTMLElement>('[data-user-avatar]').forEach((el) => {
		// Only an address the server issued is ever put into a style: a data URL, this site's own /api/media/avatars/…, or the
		// storage's https address (never containing a quote, bracket, backslash or space that could end the url()).
		if (profile.avatar && SAFE_AVATAR.test(profile.avatar)) {
			el.style.backgroundImage = `url("${profile.avatar}")`;
			el.textContent = '';
		} else {
			el.style.backgroundImage = '';
			el.textContent = (profile.firstName[0] ?? '?').toUpperCase();
		}
	});
}
