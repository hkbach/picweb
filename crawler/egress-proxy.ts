import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { guardedLookup } from './download-image.ts';
import { isBlockedIp } from './ssrf-guard.ts';

// A small forward proxy on this machine that the crawler's browser must send ALL its traffic through.
// The browser never resolves names or opens connections itself, so the address that is checked is the
// address that is used. This covers what request interception in the page cannot see: WebSockets,
// workers, out-of-process frames and DNS rebinding (a name that is public when checked, internal later).

export interface EgressProxy {
	/** For the browser's proxy setting, for example http://127.0.0.1:53211 */
	server: string;
	/** Connections refused because they pointed at a private or reserved address. */
	blocked(): number;
	close(): Promise<void>;
}

const IDLE_MS = 30_000;

export async function startEgressProxy(options: { allowPrivate?: boolean } = {}): Promise<EgressProxy> {
	const lookup = options.allowPrivate ? undefined : (guardedLookup as net.LookupFunction);
	let blocked = 0;
	const sockets = new Set<net.Socket>();

	const refuse = (error: unknown) => {
		// Only the guard's own refusal counts as "blocked"; an unreachable public server is just a failure.
		if ((error as Error)?.message === 'The address is not allowed.') blocked++;
	};

	// Plain http:// requests arrive with the full address in the request line.
	const server = http.createServer((req, res) => {
		let target: URL;
		try {
			target = new URL(req.url ?? '');
		} catch {
			res.writeHead(400).end();
			return;
		}
		if (target.protocol !== 'http:') {
			res.writeHead(400).end();
			return;
		}
		// A literal IP skips the name lookup, so it is checked here.
		const literal = target.hostname.replace(/^\[|\]$/g, '');
		if (!options.allowPrivate && net.isIP(literal) && isBlockedIp(literal)) {
			blocked++;
			res.writeHead(403).end();
			return;
		}
		const headers = { ...req.headers };
		delete headers['proxy-connection'];
		delete headers['proxy-authorization'];
		const upstream = http.request(target, { method: req.method, headers, lookup, timeout: IDLE_MS }, (answer) => {
			res.writeHead(answer.statusCode ?? 502, answer.headers);
			answer.pipe(res);
		});
		upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
		upstream.on('error', (error) => {
			refuse(error);
			if (!res.headersSent) res.writeHead(403).end();
			else res.destroy();
		});
		req.pipe(upstream);
	});

	// https:// and ws(s):// arrive as CONNECT host:port; the tunnel is opened only to a checked address.
	server.on('connect', (req, client: net.Socket, head: Buffer) => {
		let host = '';
		let port = 0;
		try {
			const parsed = new URL(`http://${req.url}`);
			host = parsed.hostname.replace(/^\[|\]$/g, '');
			port = Number(parsed.port || 443);
		} catch {
			client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
			return;
		}
		// A literal IP skips the name lookup, so it is checked here.
		if (!options.allowPrivate && net.isIP(host) && isBlockedIp(host)) {
			blocked++;
			client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
			return;
		}
		const upstream = net.connect({ host, port, lookup, timeout: IDLE_MS });
		upstream.once('connect', () => {
			client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			if (head.length > 0) upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		upstream.on('timeout', () => upstream.destroy());
		upstream.on('error', (error) => {
			refuse(error);
			if (client.writable) client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
		});
		client.on('error', () => upstream.destroy());
		client.on('close', () => upstream.destroy());
	});

	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;

	return {
		server: `http://127.0.0.1:${port}`,
		blocked: () => blocked,
		close: () =>
			new Promise<void>((resolve) => {
				for (const socket of sockets) socket.destroy();
				server.close(() => resolve());
			}),
	};
}
