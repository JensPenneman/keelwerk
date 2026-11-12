import { isIP, SocketAddress } from 'node:net';

/**
 * The address in the one form a socket peer has: IPv6 lower case and compressed, an IPv4-mapped
 * one as IPv4. Text that is no IP address, or that carries a zone suffix (`%eth0`), is no address:
 * undefined.
 */
export function normalizeAddress(address: string): string | undefined {
  const family = isIP(address);
  if (family === 0 || address.includes('%')) {
    return undefined;
  }
  const standard = family === 6 ? new SocketAddress({ address, family: 'ipv6' }).address : address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(standard);
  return mapped?.[1] ?? standard;
}
