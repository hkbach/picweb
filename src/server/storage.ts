import './env.ts';
import path from 'node:path';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { DATA_DIR } from './db.ts';

// Where pictures that this site stores itself (uploads from a device, or downloads from the Crawling page)
// are kept. Pictures from "From URLs" albums are not stored here: they stay on the site they came from.
//
// The place is chosen with STORAGE_DRIVER. Nothing is stored until one is set, and the upload endpoints answer
// 501 ("not implemented") instead of pretending:
//   STORAGE_DRIVER=r2      Cloudflare R2 (see docs/HUONG-DAN-CLOUDFLARE.md, and `npm run check-storage` to test it).
//   STORAGE_DRIVER=local   keeps files in DATA_DIR/uploads and serves them from /api/media/<name>. For
//                          development and tests, and for a single server; it is not a cloud host.
// Another cloud (Azure Blob, ...) is added by implementing PhotoStorage below and returning it from getStorage().
// It must put the object, return the public address of it, and delete it again.
export interface PhotoStorage {
	/** Stores `bytes` under `key` (replacing an identical object is fine) and returns the address pictures are shown from. */
	put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
	remove(key: string): Promise<void>;
	/** Every picture this site stored (names it gave, see MEDIA_KEY), with size and the time it was stored. */
	list(): Promise<Listing>;
	/** The address a stored picture is shown from. */
	publicUrl(key: string): string;
}

export interface StoredObject {
	key: string;
	bytes: number;
	/** When it was stored, as an ISO date. */
	modified: string;
}

/** The most pictures `list` returns; `truncated` says there were more. */
export const MAX_LISTED = 10_000;
export interface Listing {
	objects: StoredObject[];
	/** Objects in the storage whose names this site did not give (never listed, never deleted). */
	others: number;
	truncated: boolean;
}

/** A storage failure whose message is safe to show to the administrator (it never contains a key or secret). */
export class StorageError extends Error {
	/** What kind of failure it was, for tools that give more specific advice. */
	kind: R2ErrorKind;
	// (written without a "parameter property": the command-line scripts run this file as it is, without a compiler)
	constructor(message: string, kind: R2ErrorKind = 'other') {
		super(message);
		this.kind = kind;
	}
}

/** Names this server gives stored pictures: 32 hex characters of the content hash, then the type. */
export const MEDIA_KEY = /^[a-f0-9]{32}\.(jpg|png|gif|webp)$/;

export const MEDIA_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const local: PhotoStorage = {
	async put(key, bytes) {
		if (!MEDIA_KEY.test(key)) throw new Error('Invalid storage key.');
		await mkdir(UPLOADS_DIR, { recursive: true });
		await writeFile(path.join(UPLOADS_DIR, key), bytes);
		return `/api/media/${key}`;
	},
	async remove(key) {
		if (!MEDIA_KEY.test(key)) return;
		await unlink(path.join(UPLOADS_DIR, key)).catch(() => {});
	},
	publicUrl: (key) => `/api/media/${key}`,
	async list() {
		const names = await readdir(UPLOADS_DIR).catch(() => [] as string[]);
		const objects: StoredObject[] = [];
		let others = 0;
		for (const name of names) {
			if (!MEDIA_KEY.test(name)) {
				others++;
				continue;
			}
			try {
				const info = await stat(path.join(UPLOADS_DIR, name));
				if (info.isFile()) objects.push({ key: name, bytes: info.size, modified: info.mtime.toISOString() });
			} catch {
				// removed while listing
			}
		}
		return { objects: objects.slice(0, MAX_LISTED), others, truncated: objects.length > MAX_LISTED };
	},
};

// ---------------------------------------------------------------------------------------------------------------
// Cloudflare R2. R2 speaks the S3 protocol, so the official S3 client is used. Pictures are public (anyone who opens the
// Homepage must see them), so the bucket is read through its public address and only this server may write to it.
export interface R2Config {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	/** Where pictures are shown from, without a trailing slash (the bucket's public address, or your own domain). */
	publicUrl: string;
	/** Where the S3 API is: https://<account>.r2.cloudflarestorage.com unless R2_ENDPOINT says otherwise. */
	endpoint: string;
}

const R2_VARIABLES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'] as const;

export type R2Problem = { variable: string; why: 'account-id' | 'bucket' | 'public-url' | 'endpoint' };

/** The R2 settings, or what is missing / wrong with them (used by the server and by `npm run check-storage`). */
export function readR2Config(): { config: R2Config | null; missing: string[]; problems: R2Problem[] } {
	const get = (name: string) => process.env[name]?.trim() ?? '';
	const missing = R2_VARIABLES.filter((name) => get(name) === '') as string[];
	const problems: R2Problem[] = [];

	const accountId = get('R2_ACCOUNT_ID');
	if (accountId && !/^[a-f0-9]{32}$/i.test(accountId)) problems.push({ variable: 'R2_ACCOUNT_ID', why: 'account-id' });
	const bucket = get('R2_BUCKET');
	if (bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) problems.push({ variable: 'R2_BUCKET', why: 'bucket' });

	let publicUrl = get('R2_PUBLIC_URL');
	if (publicUrl) {
		try {
			const url = new URL(publicUrl);
			if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
			if (url.username || url.password || url.search || url.hash) throw new Error('parts');
			publicUrl = (url.origin + url.pathname).replace(/\/+$/, '');
		} catch {
			problems.push({ variable: 'R2_PUBLIC_URL', why: 'public-url' });
			publicUrl = '';
		}
	}

	let endpoint = get('R2_ENDPOINT') || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
	if (endpoint) {
		try {
			const url = new URL(endpoint);
			if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
			endpoint = url.origin;
		} catch {
			problems.push({ variable: 'R2_ENDPOINT', why: 'endpoint' });
			endpoint = '';
		}
	}

	if (missing.length > 0 || problems.length > 0 || !endpoint) return { config: null, missing, problems };
	return { config: { accountId, accessKeyId: get('R2_ACCESS_KEY_ID'), secretAccessKey: get('R2_SECRET_ACCESS_KEY'), bucket, publicUrl, endpoint }, missing, problems };
}

export type R2ErrorKind = 'bucket' | 'denied' | 'unreachable' | 'other';

/** What kind of failure an R2 request had. Looks at status and names only, so no key or secret can end up in a message. */
export function r2ErrorKind(error: unknown): R2ErrorKind {
	const e = error as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number }; cause?: { code?: string } } | undefined;
	const status = e?.$metadata?.httpStatusCode;
	const code = e?.cause?.code ?? e?.code;
	if (e?.name === 'NoSuchBucket' || e?.Code === 'NoSuchBucket') return 'bucket';
	if (status === 401 || status === 403 || e?.name === 'AccessDenied' || e?.name === 'InvalidAccessKeyId' || e?.name === 'SignatureDoesNotMatch') return 'denied';
	if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || e?.name === 'TimeoutError') return 'unreachable';
	return 'other';
}

/** The message shown in the admin pages (English, like the rest of them). */
export const R2_ERROR_MESSAGE: Record<R2ErrorKind, string> = {
	bucket: 'The photo storage (Cloudflare R2) could not find the bucket. Check the bucket name in the server settings.',
	denied: 'The photo storage (Cloudflare R2) refused the upload. Check the access key and secret, and that the token may write to this bucket.',
	unreachable: 'The photo storage (Cloudflare R2) could not be reached. Check the account ID in the server settings and the internet connection.',
	other: 'The photo storage (Cloudflare R2) did not accept the pictures. Run "npm run check-storage" on the server to see why.',
};

/** What to tell the administrator when reading or deleting (rather than uploading) failed. */
export const R2_READ_MESSAGE: Record<R2ErrorKind, string> = {
	bucket: 'Cloudflare R2 could not find the bucket. Check the bucket name in the server settings.',
	denied: 'Cloudflare R2 refused the request. Check that the access key may read and delete objects in this bucket.',
	unreachable: 'Cloudflare R2 could not be reached. Check the account ID in the server settings and the internet connection.',
	other: 'Cloudflare R2 did not answer as expected. Run "npm run check-storage" on the server to see why.',
};

function r2Storage(config: R2Config): PhotoStorage {
	// The S3 client is loaded on first use, so a site that does not use R2 never loads it.
	let client: Promise<{ s3: import('@aws-sdk/client-s3').S3Client; lib: typeof import('@aws-sdk/client-s3') }> | undefined;
	const open = () =>
		(client ??= import('@aws-sdk/client-s3').then((lib) => ({
			lib,
			s3: new lib.S3Client({
				region: 'auto', // R2 has one region; "auto" is the value it expects
				endpoint: config.endpoint,
				forcePathStyle: true,
				credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
				maxAttempts: 3,
				// Recent versions of the S3 client add checksum trailers to every upload by default; Cloudflare advises
				// turning that off for R2 (only checksums that an operation requires are sent).
				requestChecksumCalculation: 'WHEN_REQUIRED',
				responseChecksumValidation: 'WHEN_REQUIRED',
			}),
		})));
	return {
		async put(key, bytes, contentType) {
			if (!MEDIA_KEY.test(key)) throw new Error('Invalid storage key.');
			try {
				const { s3, lib } = await open();
				await s3.send(
					new lib.PutObjectCommand({
						Bucket: config.bucket,
						Key: key,
						Body: bytes,
						ContentType: contentType,
						// The name is a hash of the content, so what is behind it never changes.
						CacheControl: 'public, max-age=31536000, immutable',
					}),
				);
			} catch (error) {
				const kind = r2ErrorKind(error);
				throw new StorageError(R2_ERROR_MESSAGE[kind], kind);
			}
			return `${config.publicUrl}/${key}`;
		},
		async remove(key) {
			if (!MEDIA_KEY.test(key)) return;
			const { s3, lib } = await open();
			await s3.send(new lib.DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
		},
		publicUrl: (key) => `${config.publicUrl}/${key}`,
		async list() {
			const objects: StoredObject[] = [];
			let others = 0;
			let truncated = false;
			try {
				const { s3, lib } = await open();
				let token: string | undefined;
				do {
					const page = await s3.send(new lib.ListObjectsV2Command({ Bucket: config.bucket, ContinuationToken: token, MaxKeys: 1000 }));
					for (const object of page.Contents ?? []) {
						if (!object.Key || !MEDIA_KEY.test(object.Key)) {
							others++;
							continue;
						}
						if (objects.length >= MAX_LISTED) truncated = true;
						else objects.push({ key: object.Key, bytes: object.Size ?? 0, modified: (object.LastModified ?? new Date(0)).toISOString() });
					}
					token = page.IsTruncated ? page.NextContinuationToken : undefined;
				} while (token && !truncated);
			} catch (error) {
				const kind = r2ErrorKind(error);
				throw new StorageError(R2_READ_MESSAGE[kind], kind);
			}
			return { objects, others, truncated };
		},
	};
}

export const storageDriver = () => process.env.STORAGE_DRIVER?.trim() ?? '';

let r2Cache: { key: string; storage: PhotoStorage } | undefined;
let warned = false;

/** The configured storage, or null when none is (or its settings are incomplete: `npm run check-storage` says what is missing). */
export function getStorage(): PhotoStorage | null {
	const driver = storageDriver();
	if (driver === 'local') return local;
	if (driver === 'r2') {
		const { config, missing, problems } = readR2Config();
		if (!config) {
			if (!warned) {
				warned = true;
				console.warn(`[storage] STORAGE_DRIVER=r2 but the settings are not complete (${[...missing.map((m) => `${m} is missing`), ...problems.map((p) => `${p.variable} is not valid`)].join(', ')}). Run: npm run check-storage`);
			}
			return null;
		}
		const key = JSON.stringify(config);
		if (r2Cache?.key !== key) r2Cache = { key, storage: r2Storage(config) };
		return r2Cache.storage;
	}
	return null;
}

/** Reads a stored picture from the local driver (used to serve /api/media). */
export async function readLocal(key: string): Promise<Buffer | null> {
	if (!MEDIA_KEY.test(key)) return null;
	try {
		return await readFile(path.join(UPLOADS_DIR, key));
	} catch {
		return null;
	}
}
