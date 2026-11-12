import { BlockList, isIP } from 'node:net';
import { normalizeAddress } from './normalize-address.ts';

function familyOf(address: string): 'ipv4' | 'ipv6' | undefined {
  const kind = isIP(address);
  return kind === 4 ? 'ipv4' : kind === 6 ? 'ipv6' : undefined;
}

/** Decides which remote addresses may speak for a client through forwarding headers (S-38). */
export interface TrustedProxies {
  /**
   * The client address, in the one standard form (lower case, compressed, a mapped one as IPv4):
   * the socket's own (its zone dropped) unless the socket is a trusted proxy. A forwarded entry that
   * is no address, one with a zone suffix included, gives the socket's address.
   */
  clientAddress(socketAddress: string, forwardedFor: string | null): string;
}

/**
 * Parses CIDR ranges (a bare address is a single host) once, at boot; an invalid range is a
 * configuration error. The list is empty by default, so forwarding headers are ignored unless the
 * deployment names its proxies (S-38).
 */
export function trustedProxies(ranges: readonly string[]): TrustedProxies {
  const list = new BlockList();
  for (const range of ranges) {
    const [address = '', length] = range.split('/');
    const family = familyOf(address);
    const bits = length === undefined ? (family === 'ipv4' ? 32 : 128) : Number(length);
    const max = family === 'ipv4' ? 32 : 128;
    if (family === undefined || !Number.isInteger(bits) || bits < 0 || bits > max) {
      throw new TypeError(`trustedProxies: '${range}' is not a CIDR range.`);
    }
    list.addSubnet(address, bits, family);
  }
  const trusted = (address: string): boolean => {
    const family = familyOf(address);
    return family !== undefined && list.check(address, family);
  };
  return {
    clientAddress(socketAddress, forwardedFor) {
      const socket =
        normalizeAddress(socketAddress.split('%')[0] ?? socketAddress) ?? socketAddress;
      if (forwardedFor === null || !trusted(socket)) {
        return socket;
      }
      const chain = forwardedFor.split(',').map((entry) => normalizeAddress(entry.trim()) ?? '');
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        const entry = chain[index] ?? '';
        if (familyOf(entry) === undefined) {
          return socket;
        }
        if (!trusted(entry)) {
          return entry;
        }
      }
      return chain[0] ?? socket;
    },
  };
}
