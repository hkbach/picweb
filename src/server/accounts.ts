import type { SessionUser } from './sessions.ts';

/** What the browser is told about a signed-in user: never the hash, never more than it needs. */
export const toPublic = (user: SessionUser) => ({
	id: user.id,
	firstName: user.firstName,
	lastName: user.lastName,
	email: user.email,
	role: user.role,
	mustChangePassword: user.mustChangePassword,
	avatar: user.avatar,
});
