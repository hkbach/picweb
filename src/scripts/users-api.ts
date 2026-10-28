// User service calls. The server (src/pages/api/admin/users) allows administrators only, ends a user's
// sessions when they are deactivated, keeps emails unique and records who changed what (audit_log, by id).
// Still to do: the email telling a user their password was changed (no email service is connected).
export interface UserInput {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	status: 'active' | 'deactivated';
}

/**
 * An administrator setting a new password for a user. Handle with care on the server:
 *  - hash it with a slow password hash (Argon2id or bcrypt) and never store or log the plain text,
 *  - end the user's active sessions so the old password stops working everywhere,
 *  - when `mustChangeAtNextSignIn` is true, make the user choose their own password at next sign-in,
 *  - (not done yet: no email service) tell the user by email that their password was changed.
 */
export interface PasswordReset {
	id: string;
	password: string;
	mustChangeAtNextSignIn: boolean;
}

export interface UserChanges {
	/** New users. Their ids are temporary; the service assigns the real ones. */
	created: UserInput[];
	/** Users whose name, email or status changed (activating and deactivating included). */
	updated: UserInput[];
	/** Ids of users to delete. */
	deleted: string[];
	/** Passwords an administrator set for users. Never contains passwords of deleted users. */
	passwordResets: PasswordReset[];
}

export type UserSaveResult =
	| { ok: true; /** Temporary id of each new user -> the id the server gave it. */ ids: Record<string, string> }
	| { ok: false; reason: 'not-configured' | 'error'; error?: string };

// Sent to /api/admin/users (see src/pages/api/admin/users/index.ts), which applies everything as one unit.
export async function saveUserChanges(changes: UserChanges): Promise<UserSaveResult> {
	try {
		const response = await fetch('/api/admin/users', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(changes),
			credentials: 'same-origin',
		});
		const data = await response.json().catch(() => ({}));
		if (response.ok) return { ok: true, ids: data.ids ?? {} };
		return { ok: false, reason: 'error', error: typeof data.error === 'string' ? data.error : undefined };
	} catch {
		return { ok: false, reason: 'error' };
	}
}
