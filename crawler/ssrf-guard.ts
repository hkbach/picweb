import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// Address ranges a crawler must never reach: loopback, private networks, link-local
// (includes the cloud metadata address 169.254.169.254), CGNAT, multicast and reserved space.
const blocked = new BlockList();
const v4: Array<[string, number]> = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24], // documentation (TEST-NET-1)
	['192.88.99.0', 24], // old 6to4 relays
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24], // TEST-NET-2
	['203.0.113.0', 24], // TEST-NET-3
	['224.0.0.0', 4],
	['240.0.0.0', 4],
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
	['::', 96], // unspecified, and IPv4-compatible (::a.b.c.d) addresses
	['::1', 128],
	// No rule for ::ffff:0:0/96 (IPv4-mapped): BlockList matches every IPv4 address against it. Mapped
	// addresses are turned back into IPv4 in isBlockedIp instead.
	['64:ff9b::', 96], // NAT64: can lead to any IPv4 address, private ones included
	['64:ff9b:1::', 48],
	['100::', 64], // discard
	['2001::', 32], // Teredo tunnels
	['2001:db8::', 32], // documentation
	['2002::', 16], // 6to4 tunnels
	['fc00::', 7],
	['fe80::', 10],
	['fec0::', 10], // old site-local
	['ff00::', 8],
] as Array<[string, number]>) {
	blocked.addSubnet(net, prefix, 'ipv6');
}

export function isBlockedIp(ip: string): boolean {
	const kind = isIP(ip);
	if (kind === 0) return true; // not an IP: treat as unsafe
	if (kind === 4) return blocked.check(ip, 'ipv4');
	// IPv4-mapped IPv6 (::ffff:10.0.0.1, ::ffff:a00:1, 0:0:0:0:0:ffff:a00:1) is judged by its IPv4 part.
	const mapped = mappedIpv4(ip);
	if (mapped) return blocked.check(mapped, 'ipv4');
	return blocked.check(ip, 'ipv6');
}

/** The IPv4 address inside an IPv4-mapped IPv6 address, or null. */
function mappedIpv4(ip: string): string | null {
	let text = ip.toLowerCase();
	// Write a trailing dotted IPv4 part as two hex groups so every form looks the same.
	const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
	if (dotted) {
		const [a, b, c, d] = dotted.slice(1).map(Number);
		text = text.slice(0, dotted.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
	const left = head ? head.split(':') : [];
	const right = tail ? tail.split(':') : [];
	const groups = tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
	if (groups.length !== 8) return null;
	const n = groups.map((g) => parseInt(g, 16));
	if (n.slice(0, 5).some((g) => g !== 0) || n[5] !== 0xffff) return null;
	return [n[6] >> 8, n[6] & 0xff, n[7] >> 8, n[7] & 0xff].join('.');
}

/**
 * Throws unless every address the hostname resolves to is public. The message never names the resolved
 * address, so the error cannot be used to map what names mean inside this server's network.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
	const host = hostname.replace(/^\[|\]$/g, '');
	if (isIP(host)) {
		if (isBlockedIp(host)) throw new Error(`${host} is a private or reserved address and cannot be used.`);
		return;
	}
	const addresses = await lookup(host, { all: true }).catch(() => []);
	if (addresses.length === 0) throw new Error(`Could not resolve ${host}`);
	if (addresses.some(({ address }) => isBlockedIp(address))) throw new Error(`${host} points to a private or reserved address and cannot be used.`);
}
