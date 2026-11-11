import type { BlockList } from 'node:net';

/**
 * Whether an IP address is in the special-purpose tables of RFC 6890 (and its updates) for IPv4 and
 * IPv6: unspecified, loopback, private (RFC 1918, RFC 4193), shared, link-local, documentation,
 * benchmarking, multicast and reserved. An IPv6 address that embeds an IPv4 address (mapped,
 * compatible, translated, NAT64, local-use NAT64, 6to4: `embeddedIpv4Of`) is not in the IPv6 table
 * and is judged by the IPv4 address it carries.
 */
export function isSpecialPurposeAddress(list: BlockList, address: string, family: 4 | 6): boolean {
  return list.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
