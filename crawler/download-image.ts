import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { isBlockedIp } from './ssrf-guard.ts';

export interface DownloadOptions {
	/** Folder the image is saved in. Created if missing. */
	dir: string;
	/** Largest image accepted, in bytes. */
	maxBytes?: number;
	/** Give up when the server stays silent this long (milliseconds). */
	timeoutMs?: number;
	/** Give up on one image after this long in total, however slowly the server keeps sending (milliseconds). */
	totalTimeoutMs?: number;
	/** Most files the folder may hold, so a runaway job cannot fill the disk. */
	maxFiles?: number;
	/** Most bytes the folder may hold in total; with maxFiles alone 2000 large images could still fill tens of GB. */
	maxTotalBytes?: number;
	/** Allow loopback / private-network addresses. Off by default; only for tests against a local server. */
	allowPrivate?: boolean;
}

export interface DownloadedImage {
	/** The name the file is stored under: a code made from the picture's content, never taken from the source. */
	name: string;
	bytes: number;
	type: 'jpg' | 'png' | 'gif' | 'webp';
	/** True when this exact picture was already stored, so no second copy was written. */
	existed: boolean;
}

/** Characters of the hash kept in a name (128 bits: more than enough that two pictures never collide). */
export const NAME_LENGTH = 32;

/** A failure whose message is safe to show to the admin. */
export class DownloadError extends Error {}

const DEFAULTS = { maxBytes: 15 * 1024 * 1024, timeoutMs: 30_000, totalTimeoutMs: 60_000, maxFiles: 2000, maxTotalBytes: 2 * 1024 * 1024 * 1024 };
const MAX_REDIRECTS = 5;
const TOO_LONG = 'The download took too long.';

// Checked at the moment the socket connects, so the address that was checked is the address used:
// a name that resolves to a public address first and an internal one later cannot slip through.
// Also used by the crawler's egress proxy.
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: (...args: any[]) => void) {
	dns.lookup(hostname, { family: options.family, hints: options.hints, all: true }, (error, addresses) => {
		if (error) return callback(error);
		if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
			return callback(new DownloadError('The address is not allowed.'));
		}
		if (options.all) return callback(null, addresses);
		callback(null, addresses[0].address, addresses[0].family);
	});
}

// Only the file's own first bytes say what it is; the URL and the Content-Type header can both lie.
export function sniffImage(bytes: Uint8Array): DownloadedImage['type'] | null {
	const at = (i: number) => bytes[i];
	const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
	if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg';
	if (bytes.length >= 8 && at(0) === 0x89 && ascii(1, 4) === 'PNG' && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'png';
	if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif';
	if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
	return null; // SVG and everything else is refused (SVG can carry scripts)
}

function get(url: URL, timeoutMs: number, allowPrivate: boolean, signal: AbortSignal): Promise<http.IncomingMessage> {
	const client = url.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const request = client.get(
			url,
			{
				headers: { 'user-agent': 'PicwebDownloader/0.1', accept: 'image/*' },
				timeout: timeoutMs,
				signal,
				...(allowPrivate ? {} : { lookup: guardedLookup as net.LookupFunction }),
			},
			resolve,
		);
		request.on('timeout', () => request.destroy(new DownloadError('The server took too long to answer.')));
		request.on('error', (error) => reject(error instanceof DownloadError ? error : signal.aborted ? new DownloadError(TOO_LONG) : new DownloadError(`Could not reach the server (${(error as NodeJS.ErrnoException).code ?? 'network error'}).`)));
	});
}

export async function downloadImage(sourceUrl: string, options: DownloadOptions): Promise<DownloadedImage> {
	const { maxBytes, timeoutMs, totalTimeoutMs, maxFiles, maxTotalBytes } = { ...DEFAULTS, ...options };
	const allowPrivate = options.allowPrivate === true;

	let url: URL;
	try {
		url = new URL(sourceUrl);
	} catch {
		throw new DownloadError('Not a valid URL.');
	}

	// The idle timeout alone lets a server drip one byte at a time forever; this caps the whole download.
	const signal = AbortSignal.timeout(totalTimeoutMs);

	// Follow redirects by hand so every hop is checked, not only the first address.
	let response: http.IncomingMessage | undefined;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DownloadError('Only http:// and https:// addresses can be downloaded.');
		if (url.username || url.password) throw new DownloadError('Addresses with embedded credentials are not allowed.');
		// An address typed as digits skips the DNS step, so it is checked here.
		const host = url.hostname.replace(/^\[|\]$/g, '');
		if (!allowPrivate && net.isIP(host) && isBlockedIp(host)) throw new DownloadError('The address is not allowed.');

		response = await get(url, timeoutMs, allowPrivate, signal);
		const status = response.statusCode ?? 0;
		if (status >= 300 && status < 400 && response.headers.location) {
			response.resume();
			if (hop === MAX_REDIRECTS) throw new DownloadError('Too many redirects.');
			try {
				url = new URL(response.headers.location, url);
			} catch {
				throw new DownloadError('The server sent an invalid redirect.');
			}
			continue;
		}
		if (status !== 200) {
			response.resume();
			throw new DownloadError(`The server answered with HTTP ${status}.`);
		}
		break;
	}
	if (!response) throw new DownloadError('No answer from the server.');

	const declared = Number(response.headers['content-length']);
	if (Number.isFinite(declared) && declared > maxBytes) {
		response.destroy();
		throw new DownloadError('The image is larger than the allowed size.');
	}

	// Read the body with a hard cap, whatever the server claimed.
	const chunks: Buffer[] = [];
	let received = 0;
	try {
		for await (const chunk of response as AsyncIterable<Buffer>) {
			received += chunk.length;
			if (received > maxBytes) {
				response.destroy();
				throw new DownloadError('The image is larger than the allowed size.');
			}
			chunks.push(chunk);
		}
	} catch (error) {
		throw error instanceof DownloadError ? error : new DownloadError(signal.aborted ? TOO_LONG : 'The download was interrupted.');
	}
	const body = Buffer.concat(chunks);

	const type = sniffImage(body);
	if (!type) throw new DownloadError('Not a supported image (JPG, PNG, GIF or WebP).');

	await mkdir(options.dir, { recursive: true });

	// The name is a code made from the picture itself (a SHA-256 hash), so nothing from the source reaches
	// the file system, two different pictures never share a name, and the same picture always gets the
	// same name: downloading it again finds the file already there instead of storing a second copy.
	const name = `${createHash('sha256').update(body).digest('hex').slice(0, NAME_LENGTH)}.${type}`;
	const target = path.join(options.dir, name);

	const alreadyStored = async () => {
		// Seen again: refresh its date so it shows as a recent download and the list stays truthful.
		const now = new Date();
		await utimes(target, now, now).catch(() => {});
		return { name, bytes: body.length, type, existed: true };
	};
	if (await stat(target).then(() => true, () => false)) return alreadyStored();

	const stored = (await readdir(options.dir)).filter((f) => !f.startsWith('.'));
	if (stored.length >= maxFiles) throw new DownloadError('The download folder is full.');
	const sizes = await Promise.all(stored.map((f) => stat(path.join(options.dir, f)).then((s) => s.size, () => 0)));
	if (sizes.reduce((a, b) => a + b, 0) + body.length > maxTotalBytes) throw new DownloadError('The download folder is full.');

	try {
		await writeFile(target, body, { flag: 'wx' });
	} catch (error) {
		// Another download of the same picture finished first (several run at once): that is a duplicate, not a failure.
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') return alreadyStored();
		throw error;
	}
	return { name, bytes: body.length, type, existed: false };
}
