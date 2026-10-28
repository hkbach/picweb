import { db } from './db.ts';

/**
 * Records that an administrator did something. Only ids and field names go in `detail`: never names, emails,
 * passwords or anything else that is personal data, so the log can be kept and read more freely than the users.
 */
export function audit(actorId: string | null, action: string, target?: string, detail?: string) {
	db().prepare('INSERT INTO audit_log (at, actor_id, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(new Date().toISOString(), actorId, action, target ?? null, detail ?? null);
}
