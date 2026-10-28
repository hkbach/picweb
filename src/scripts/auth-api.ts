// Account service calls (see src/pages/api/auth and src/pages/api/account). Passwords are only ever sent
// to the server over the request body; they are never stored in the browser or logged.
export interface AccountUser {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	role: 'user' | 'admin';
	mustChangePassword: boolean;
	avatar: string | null;
}

export type AuthResult = { ok: true; user: AccountUser } | { ok: false; error: string };
export type PasswordResult = { ok: true } | { ok: false; reason: 'error'; error: string };

const post = async (url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> => {
	try {
		const response = await fetch(url, {
			method,
			headers: body === undefined ? undefined : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: 'same-origin',
		});
		const data = await response.json().catch(() => ({}));
		return { ok: response.ok, status: response.status, data };
	} catch {
		return { ok: false, status: 0, data: {} };
	}
};

const failure = (r: { status: number; data: any }, fallback: string): { ok: false; error: string } => ({
	ok: false,
	error: typeof r.data?.error === 'string' ? r.data.error : r.status === 0 ? 'The server could not be reached. Check your connection and try again.' : fallback,
});

/** Who is signed in, or null. */
export async function fetchMe(): Promise<AccountUser | null> {
	const r = await post('/api/auth/me', 'GET');
	return r.ok ? (r.data.user ?? null) : null;
}

export async function login(email: string, password: string): Promise<AuthResult> {
	const r = await post('/api/auth/login', 'POST', { email, password });
	return r.ok ? { ok: true, user: r.data.user } : failure(r, 'Login failed. Please try again.');
}

export async function register(input: { firstName: string; lastName: string; email: string; password: string }): Promise<AuthResult> {
	const r = await post('/api/auth/register', 'POST', input);
	return r.ok ? { ok: true, user: r.data.user } : failure(r, 'The account could not be created. Please try again.');
}

export async function logout(): Promise<void> {
	await post('/api/auth/logout', 'POST');
}

export async function saveProfile(profile: { firstName: string; lastName: string; avatar: string | null }): Promise<AuthResult> {
	const r = await post('/api/account/profile', 'PUT', profile);
	return r.ok ? { ok: true, user: r.data.user } : failure(r, 'The profile could not be saved.');
}

export async function changePassword(next: string): Promise<PasswordResult> {
	const r = await post('/api/account/password', 'POST', { password: next });
	return r.ok ? { ok: true } : { ok: false, reason: 'error', error: failure(r, 'The password could not be changed.').error };
}
