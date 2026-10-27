// Account service calls. No backend exists yet, so nothing here can really change a password.
// Replace the body of changePassword with a request to the real service; the Profile page
// already handles each result below. Passwords must never be stored in the browser or logged.
export type PasswordResult = { ok: true } | { ok: false; reason: 'not-configured' | 'error' };

export async function changePassword(_next: string): Promise<PasswordResult> {
	return { ok: false, reason: 'not-configured' };
}
