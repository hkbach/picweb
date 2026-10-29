import './env.ts';
import { isIP } from 'node:net';

// The address of the person making a request. Behind a reverse proxy (Caddy, Nginx, Cloudflare) every request reaches the
// app from the proxy itself, so the rate limits would treat all visitors as one and the traffic page would see one visitor.
// Set CLIENT_IP_HEADER to the header the proxy writes: "x-forwarded-for" behind Caddy or Nginx, "cf-connecting-ip" behind
// Cloudflare. Only set it when the app can be reached ONLY through that proxy (HOST=127.0.0.1): otherwise anyone could
// send the header and choose their own address.
//
// For X-Forwarded-For the LAST address is used: that is the one the proxy added itself; earlier ones come from the
// visitor and can be made up.
export function clientIp(request: Request, socketAddress: string): string {
	const header = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
	if (header) {
		const value = request.headers.get(header);
		const candidate = value?.split(',').map((part) => part.trim()).filter(Boolean).at(-1);
		if (candidate && isIP(candidate)) return candidate;
	}
	return socketAddress;
}
