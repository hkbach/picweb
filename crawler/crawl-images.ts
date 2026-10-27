import { chromium } from 'playwright';
import { assertPublicHost } from './ssrf-guard.ts';
import { startEgressProxy } from './egress-proxy.ts';

export interface CrawlOptions {
	/** Stop after this many images. */
	maxImages?: number;
	/** Skip images whose width or height is below this many pixels (icons, logos, trackers). */
	minSize?: number;
	/** Navigation timeout in milliseconds. */
	timeoutMs?: number;
	/** The whole crawl is stopped after this long, whatever the page does (milliseconds). */
	totalTimeoutMs?: number;
	/** Allow loopback / private-network targets. Off by default; only for local testing. */
	allowPrivate?: boolean;
	userAgent?: string;
}

export interface FoundImage {
	url: string;
	alt: string;
	/** Natural size in pixels, measured in the browser. */
	width: number;
	height: number;
	source: 'img' | 'css' | 'meta';
}

export interface CrawlResult {
	requestedUrl: string;
	finalUrl: string;
	title: string;
	images: FoundImage[];
	/** Requests refused because they pointed at a blocked address or scheme. */
	blockedRequests: number;
}

// What the page hands back is data from an untrusted site: it is checked and capped before use.
const MAX_RAW_ITEMS = 5000;
const MAX_URL_LENGTH = 2048;
const MAX_ALT_LENGTH = 300;
/** Distinct host names looked up when filtering the results, so a page cannot cause thousands of DNS queries. */
const MAX_RESULT_HOSTS = 100;

function cleanItems(raw: unknown): FoundImage[] {
	if (!Array.isArray(raw)) return [];
	const items: FoundImage[] = [];
	for (const item of raw.slice(0, MAX_RAW_ITEMS)) {
		if (!item || typeof item !== 'object') continue;
		const { url, alt, width, height, source } = item as Record<string, unknown>;
		if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) continue;
		if (source !== 'img' && source !== 'css' && source !== 'meta') continue;
		const size = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 100_000) : 0);
		items.push({ url, alt: typeof alt === 'string' ? alt.slice(0, MAX_ALT_LENGTH) : '', width: size(width), height: size(height), source });
	}
	return items;
}

const DEFAULTS = {
	maxImages: 200,
	minSize: 400,
	timeoutMs: 30_000,
	totalTimeoutMs: 90_000,
	allowPrivate: false,
	userAgent: 'PicwebCrawler/0.1',
};

export function parseTargetUrl(input: string): URL {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw new Error('Target URL is not a valid absolute URL.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only http:// and https:// URLs can be crawled.');
	}
	if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed.');
	return url;
}

export async function crawlImages(targetUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
	const opts = { ...DEFAULTS, ...options };
	const url = parseTargetUrl(targetUrl);
	if (!opts.allowPrivate) await assertPublicHost(url.hostname);

	// All the browser's traffic goes through a local proxy that checks the address it actually connects to
	// (WebSockets, workers and every frame included). "<-loopback>" stops Chromium from sending localhost
	// past the proxy, and WebRTC may not open its own UDP connections around it.
	const proxy = await startEgressProxy({ allowPrivate: opts.allowPrivate });
	let browser: Awaited<ReturnType<typeof chromium.launch>>;
	try {
		browser = await chromium.launch({
			headless: true,
			// The sandbox limits what a hostile page could do if it broke out of the renderer. Some container
			// hosts cannot run it; CRAWLER_CHROMIUM_SANDBOX=false turns it off there, as a known risk.
			chromiumSandbox: process.env.CRAWLER_CHROMIUM_SANDBOX !== 'false',
			proxy: { server: proxy.server, bypass: '<-loopback>' },
			args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
		});
	} catch (error) {
		await proxy.close();
		throw error;
	}

	// A hostile page can stall any step (endless scripts, images that never finish), so the whole crawl
	// has a deadline: closing the browser makes every pending step fail at once.
	let timedOut = false;
	const deadline = setTimeout(() => {
		timedOut = true;
		browser.close().catch(() => {});
	}, opts.totalTimeoutMs);

	let blockedRequests = 0;
	try {
		const context = await browser.newContext({
			userAgent: opts.userAgent,
			viewport: { width: 1366, height: 900 },
			acceptDownloads: false,
			serviceWorkers: 'block',
		});

		// Used only to filter the URLs returned to the admin (nothing connects on the strength of these
		// verdicts; the proxy checks every real connection). Cached per host, and capped.
		const hostVerdicts = new Map<string, Promise<boolean>>();
		const isAllowedHost = (hostname: string) => {
			let verdict = hostVerdicts.get(hostname);
			if (!verdict && hostVerdicts.size >= MAX_RESULT_HOSTS) return Promise.resolve(false);
			if (!verdict) {
				verdict = assertPublicHost(hostname).then(
					() => true,
					() => false,
				);
				hostVerdicts.set(hostname, verdict);
			}
			return verdict;
		};

		const page = await context.newPage();

		// A second, in-page layer: refuse schemes other than http(s) and skip fonts and media, which are not
		// needed to collect images. The address check itself is the proxy's job. The CDP Fetch domain is
		// used because Playwright's page.route() never sees the hops of an HTTP redirect.
		const cdp = await context.newCDPSession(page);
		cdp.on('Fetch.requestPaused', async ({ requestId, request, resourceType }) => {
			const decide = async (): Promise<boolean> => {
				// Fonts and media are not needed to collect images.
				if (resourceType === 'Font' || resourceType === 'Media') return false;
				const { protocol } = new URL(request.url);
				if (protocol === 'data:' || protocol === 'blob:' || protocol === 'about:') return true;
				if (protocol !== 'http:' && protocol !== 'https:') {
					blockedRequests++;
					return false;
				}
				return true;
			};
			const allowed = await decide().catch(() => false);
			// The page may already be closing; failing to answer then is harmless.
			await (allowed
				? cdp.send('Fetch.continueRequest', { requestId })
				: cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
			).catch(() => {});
		});
		await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
		await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
		// Best effort: many sites keep connections open forever, so a timeout here is fine.
		await page.waitForLoadState('networkidle', { timeout: Math.min(opts.timeoutMs, 10_000) }).catch(() => {});

		// Scroll down in steps so lazy-loaded images are requested. Bounded in steps and time.
		await page.evaluate(async () => {
			const deadline = Date.now() + 8000;
			for (let i = 0; i < 40 && Date.now() < deadline; i++) {
				const before = window.scrollY;
				window.scrollBy(0, window.innerHeight);
				await new Promise((r) => setTimeout(r, 200));
				if (window.scrollY === before) break;
			}
			window.scrollTo(0, 0);
		});
		await page.waitForTimeout(500);

		const raw = cleanItems(await page.evaluate(async () => {
			const found: Array<{ url: string; alt: string; width: number; height: number; source: 'img' | 'css' | 'meta' }> = [];
			const toAbsolute = (value: string) => {
				try {
					return new URL(value, document.baseURI).href;
				} catch {
					return null;
				}
			};

			for (const img of Array.from(document.images)) {
				const src = img.currentSrc || img.src;
				if (src) found.push({ url: src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight, source: 'img' });
			}

			// CSS background images (capped so huge pages stay fast).
			const elements = Array.from(document.querySelectorAll('*')).slice(0, 5000);
			for (const el of elements) {
				const background = getComputedStyle(el).backgroundImage;
				if (!background || background === 'none') continue;
				for (const match of background.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
					const abs = toAbsolute(match[2]);
					if (abs) found.push({ url: abs, alt: '', width: 0, height: 0, source: 'css' });
				}
			}

			for (const meta of Array.from(document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]'))) {
				const abs = toAbsolute(meta.getAttribute('content') ?? '');
				if (abs) found.push({ url: abs, alt: '', width: 0, height: 0, source: 'meta' });
			}

			// CSS backgrounds, meta images and images that had not loaded yet have no size so far.
			// Measure them by loading each one in the page (this goes through the same request guard),
			// otherwise the size filter below could not tell a hero photo from an icon.
			const measure = (url: string) =>
				new Promise<[number, number]>((resolve) => {
					const probe = new Image();
					const timer = setTimeout(() => resolve([0, 0]), 8000);
					probe.onload = () => {
						clearTimeout(timer);
						resolve([probe.naturalWidth, probe.naturalHeight]);
					};
					probe.onerror = () => {
						clearTimeout(timer);
						resolve([0, 0]);
					};
					probe.src = url;
				});
			const unmeasured = found.filter((item) => item.width === 0 || item.height === 0).slice(0, 150);
			await Promise.all(
				unmeasured.map(async (item) => {
					[item.width, item.height] = await measure(item.url);
				}),
			);

			return found;
		}));

		// Keep only real web images, drop small ones, remove duplicates (first occurrence wins).
		// An image whose size still cannot be determined cannot be shown to meet the minimum, so it is dropped.
		const seen = new Set<string>();
		const images: FoundImage[] = [];
		for (const item of raw) {
			if (images.length >= opts.maxImages) break;
			if (!/^https?:\/\//i.test(item.url) || seen.has(item.url)) continue;
			// Whoever shows these results may load the images, so never return URLs that point at
			// internal addresses (the page itself could have been written to aim at them).
			if (!opts.allowPrivate && !(await isAllowedHost(new URL(item.url).hostname))) continue;
			if (item.width < opts.minSize || item.height < opts.minSize) continue;
			seen.add(item.url);
			images.push(item);
		}

		return {
			requestedUrl: url.href,
			finalUrl: page.url(),
			title: (await page.title()).slice(0, MAX_ALT_LENGTH),
			images,
			blockedRequests: blockedRequests + proxy.blocked(),
		};
	} catch (error) {
		if (timedOut) throw new Error('The page took too long and the crawl was stopped.');
		throw error;
	} finally {
		clearTimeout(deadline);
		await browser.close().catch(() => {});
		await proxy.close();
	}
}
