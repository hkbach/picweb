import { existsSync } from 'node:fs';
import path from 'node:path';

// Settings can live in one ".env" file in the folder the server is started from (see .env.example), so nobody has to
// set environment variables by hand. A value that is already set in the real environment wins over the file. The file
// is in .gitignore: it holds secrets (the Cloudflare keys) and must never be committed or sent anywhere.
const file = path.resolve(process.cwd(), '.env');
if (existsSync(file)) {
	try {
		process.loadEnvFile(file);
	} catch {
		// an unreadable .env is treated as absent; the settings that are missing are reported where they are needed
	}
}
