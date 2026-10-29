import './env.ts';
import { existsSync, readFileSync } from 'node:fs';
import { Reader, type CountryResponse } from 'mmdb-lib';

// Which country a visit comes from, worked out on this server: the address is never sent to an outside service.
//   GEOIP_HEADER=cf-ipcountry   when the site is behind Cloudflare's proxy, which sends the country in this header;
//   GEOIP_DB=/path/country.mmdb a country database file on the server, for example the free "IP to Country Lite" of DB-IP
//                               (CC BY 4.0: the Traffic page credits it) or MaxMind GeoLite2 Country.
// With neither, the country is "ZZ" (unknown). Like CLIENT_IP_HEADER, a header is only trusted behind the proxy that sets it.

export const UNKNOWN_COUNTRY = 'ZZ';

let reader: Reader<CountryResponse> | null | undefined;

const database = () => {
	if (reader !== undefined) return reader;
	const file = process.env.GEOIP_DB?.trim();
	reader = null;
	if (file && existsSync(file)) {
		try {
			reader = new Reader<CountryResponse>(readFileSync(file));
		} catch {
			console.warn('[geo] GEOIP_DB could not be read as a country database (.mmdb); countries will show as unknown.');
		}
	}
	return reader;
};

/** Where the countries come from, for the Traffic page: 'header', 'database' or 'none'. */
export const geoSource = (): 'header' | 'database' | 'none' => (process.env.GEOIP_HEADER?.trim() ? 'header' : database() ? 'database' : 'none');

const valid = (code: unknown): code is string => typeof code === 'string' && /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== UNKNOWN_COUNTRY;

export function countryOf(request: Request, ip: string): string {
	const header = process.env.GEOIP_HEADER?.trim().toLowerCase();
	if (header) {
		const code = request.headers.get(header)?.trim().toUpperCase();
		return valid(code) ? code : UNKNOWN_COUNTRY;
	}
	const db = database();
	if (!db) return UNKNOWN_COUNTRY;
	try {
		const record = db.get(ip);
		// MaxMind-style files put it in country.iso_code; some other country files use a flat country_code.
		const code = record?.country?.iso_code ?? (record as { country_code?: string } | null)?.country_code;
		return valid(code) ? code : UNKNOWN_COUNTRY;
	} catch {
		return UNKNOWN_COUNTRY; // not an address the database understands (a private one, for example)
	}
}
