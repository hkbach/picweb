// User service calls. No backend or database exists yet, so nothing here can really store a change.
// Replace the body of saveUserChanges with a request to the real service; the Users admin page
// already handles each result below.
//
// What the real service must do, beyond storing the data:
//  - allow only administrators (the admin pages have no sign-in yet),
//  - end a user's active sessions when they are deactivated, and refuse their sign-in,
//  - make sure emails stay unique, and record who changed what (audit log),
//  - treat names and emails as personal data: restrict access, and do not copy them into logs.
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
 *  - tell the user by email that their password was changed, and record who did it (audit log).
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

export type UserSaveResult = { ok: true } | { ok: false; reason: 'not-configured' | 'error' };

export async function saveUserChanges(_changes: UserChanges): Promise<UserSaveResult> {
	return { ok: false, reason: 'not-configured' };
}
