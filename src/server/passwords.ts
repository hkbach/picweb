import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwords are stored only as scrypt hashes (memory-hard, built into Node). The plain text is never
// stored or logged. Format: scrypt$N$r$p$salt$hash (base64), so the cost can be raised later and old
// hashes still verify.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * 1024 * 1024;

export const PASSWORD_MIN = 8;
/** A cap stops someone from making the server hash megabytes of text. */
export const PASSWORD_MAX = 128;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number, length: number) =>
	new Promise<Buffer>((resolve, reject) => {
		const options: ScryptOptions = { N: n, r, p, maxmem: MAX_MEMORY };
		scrypt(password.normalize('NFKC'), salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
	});

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await derive(password, salt, N, R, P, KEY_LENGTH);
	return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, n, r, p, salt, hash] = stored.split('$');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	try {
		const key = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p), expected.length);
		return key.length === expected.length && timingSafeEqual(key, expected);
	} catch {
		return false;
	}
}

// Checked when the email is unknown, so a wrong email and a wrong password take the same time.
let decoy: Promise<string> | undefined;
export const verifyAgainstDecoy = async (password: string) => {
	decoy ??= hashPassword(randomBytes(12).toString('hex'));
	await verifyPassword(password, await decoy);
};

/** Returns a message when the password is not acceptable, otherwise null. */
export function passwordProblem(password: unknown): string | null {
	if (typeof password !== 'string') return 'Enter a password.';
	if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
	if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
	return null;
}
