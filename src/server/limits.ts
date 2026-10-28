// A small in-memory rate limiter. It slows guessing of passwords; it resets when the server restarts and
// is per process, so behind several servers a shared store (for example Redis) is the next step.
const windows = new Map<string, { count: number; resetAt: number }>();

/** True while `key` has made no more than `max` attempts in the last `windowMs`. Counts this attempt. */
export function allow(key: string, max: number, windowMs: number): boolean {
	const now = Date.now();
	if (windows.size > 10_000) for (const [k, w] of windows) if (w.resetAt < now) windows.delete(k);
	const current = windows.get(key);
	if (!current || current.resetAt < now) {
		windows.set(key, { count: 1, resetAt: now + windowMs });
		return true;
	}
	current.count++;
	return current.count <= max;
}

export const forget = (key: string) => windows.delete(key);
