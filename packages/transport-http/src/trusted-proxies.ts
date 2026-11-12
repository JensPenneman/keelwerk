import { BlockList, isIP } from 'node:net';
import { normalizeAddress } from './normalize-address.ts';

function familyOf(address: string): 'ipv4' | 'ipv6' | undefined {
  const kind = isIP(address);
  return kind === 4 ? 'ipv4' : kind === 6 ? 'ipv6' : undefined;
}

/**
 * The address a forwarded entry names: a bare IPv4 or IPv6 address, `a.b.c.d:port`, `[v6]` or
 * `[v6]:port` (a port of one to five digits, at most 65535; brackets hold IPv6 only), or an IPv6
 * address that ends in a dotted quad followed by a port (`::ffff:203.0.113.7:51234`). Text that
 * `isIP` reads as an IPv6 address is that address, so `2001:db8::1:443` is never split into an
 * address and a port. Anything else, a zone suffix included, is no address: an empty string.
 */
function entryAddress(entry: string): string {
  const text = entry.trim();
  const portOf = (port: string): boolean => /^\d{1,5}$/.test(port) && Number(port) <= 65535;
  if (isIP(text) !== 0) {
    return normalizeAddress(text) ?? '';
  }
  const bracketed = /^\[([^\]]*)\](?::(.*))?$/.exec(text);
  if (bracketed !== null) {
    const [, inner = '', port] = bracketed;
    if (isIP(inner) !== 6 || (port !== undefined && !portOf(port))) {
      return '';
    }
    return normalizeAddress(inner) ?? '';
  }
  const split = /^([^:]+):([^:]*)$/.exec(text);
  if (split !== null) {
    const [, host = '', port = ''] = split;
    return isIP(host) === 4 && portOf(port) ? (normalizeAddress(host) ?? '') : '';
  }
  // An IPv6 address that ends in a dotted quad can only be followed by a port: `::ffff:203.0.113.7:51234`.
  const dotted = /^(.+\.\d+):(\d+)$/.exec(text);
  if (dotted !== null) {
    const [, host = '', port = ''] = dotted;
    return isIP(host) === 6 && portOf(port) ? (normalizeAddress(host) ?? '') : '';
  }
  return '';
}

/** Decides which remote addresses may speak for a client through forwarding headers (S-38). */
export interface TrustedProxies {
  /**
   * The client address, in the one standard form (lower case, compressed, a mapped one as IPv4):
   * the socket's own (its zone dropped) unless the socket is a trusted proxy. A forwarded entry that
   * is no address, one with a zone suffix included, gives the socket's address. An entry may carry
   * a port (`203.0.113.7:51234`) or brackets (`[2001:db8::1]`, `[2001:db8::1]:443`); a bare IPv6
   * address is never read as an address with a port.
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
      const chain = forwardedFor.split(',').map((entry) => entryAddress(entry));
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
