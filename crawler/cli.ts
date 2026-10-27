import { crawlImages, type CrawlOptions } from './crawl-images.ts';

const USAGE = `Usage: npm run crawl -- <url> [--max <n>] [--min-size <px>] [--timeout <ms>] [--allow-private]

Collects the images on a page with Playwright and prints the result as JSON.
  --max            maximum number of images (default 200)
  --min-size       skip images whose width or height is below this many pixels (default 400)
  --timeout        navigation timeout in ms (default 30000)
  --allow-private  allow localhost / private-network targets (testing only)`;

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const options: CrawlOptions = {};

const numberAfter = (flag: string) => {
	const i = args.indexOf(flag);
	if (i === -1) return undefined;
	const value = Number(args[i + 1]);
	if (!Number.isFinite(value) || value <= 0) {
		console.error(`${flag} needs a positive number.\n\n${USAGE}`);
		process.exit(2);
	}
	return value;
};

if (!url || args.includes('--help')) {
	console.error(USAGE);
	process.exit(url ? 0 : 2);
}

options.maxImages = numberAfter('--max');
options.minSize = numberAfter('--min-size');
options.timeoutMs = numberAfter('--timeout');
options.allowPrivate = args.includes('--allow-private');
for (const key of Object.keys(options) as Array<keyof CrawlOptions>) {
	if (options[key] === undefined) delete options[key];
}

try {
	const result = await crawlImages(url, options);
	console.log(JSON.stringify(result, null, 2));
} catch (error) {
	// Playwright errors carry a long call log; the first line is the useful part.
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Crawl failed: ${message.split('\n')[0]}`);
	process.exit(1);
}
