import { isIP } from 'node:net';

/** The sixteen bytes of an IPv6 address, or undefined for a text that is none. */
function bytesOf(address: string): readonly number[] | undefined {
  if (isIP(address) !== 6) return undefined;
  let text = address.split('%')[0] ?? address;
  const tail = text.lastIndexOf(':');
  const dotted = text.slice(tail + 1);
  if (dotted.includes('.')) {
    const parts = dotted.split('.').map(Number);
    const high = ((parts[0] ?? 0) << 8) | (parts[1] ?? 0);
    const low = ((parts[2] ?? 0) << 8) | (parts[3] ?? 0);
    text = `${text.slice(0, tail + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = rest === undefined || rest === '' ? [] : rest.split(':');
  const groups =
    rest === undefined
      ? first
      : [...first, ...Array(8 - first.length - last.length).fill('0'), ...last];
  if (groups.length !== 8) return undefined;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function zeros(bytes: readonly number[], from: number, to: number): boolean {
  return bytes.slice(from, to).every((byte) => byte === 0);
}

function quad(bytes: readonly number[]): string {
  return bytes.join('.');
}

/** The IPv4 address that the bytes at `positions` spell. */
function quadAt(bytes: readonly number[], positions: readonly number[]): string {
  return quad(positions.map((position) => bytes[position] ?? 0));
}

/**
 * Where RFC 6052 section 2.2 places the IPv4 address in an address of a /48, /56, /64 and /96
 * prefix: byte 8 (the u octet) is skipped, so the address is split around it.
 */
const localUseReadings: readonly (readonly number[])[] = [
  [6, 7, 9, 10],
  [7, 9, 10, 11],
  [9, 10, 11, 12],
  [12, 13, 14, 15],
];

/**
 * The IPv4 addresses an IPv6 address carries, for the forms that embed one: IPv4-mapped
 * (`::ffff:0:0/96`), IPv4-compatible (`::/96`), IPv4-translated (`::ffff:0:0:0/96`), NAT64
 * (`64:ff9b::/96`), local-use NAT64 (`64:ff9b:1::/48`) and 6to4 (`2002::/16`, bits 16 to 47). Such
 * an address is judged by the IPv4 address it reaches, not by its own prefix. The local-use prefix
 * has no fixed length (RFC 8215: /48 to /96), so it carries one address for each length RFC 6052
 * allows inside it and the caller refuses the address when any of them is refused. Empty for any
 * other address.
 */
export function embeddedIpv4Of(address: string): readonly string[] {
  const bytes = bytesOf(address);
  if (bytes === undefined) return [];
  const last = quad(bytes.slice(12, 16));
  if (zeros(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return [last];
  // `::` and `::1` are the unspecified and the loopback address of the IPv6 table, not an embedded IPv4 address.
  if (zeros(bytes, 0, 12)) {
    return zeros(bytes, 12, 15) && (bytes[15] ?? 0) <= 1 ? [] : [last];
  }
  if (
    zeros(bytes, 0, 8) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0
  ) {
    return [last];
  }
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (zeros(bytes, 4, 12)) return [last];
    if (bytes[4] === 0 && bytes[5] === 1) {
      return localUseReadings.map((positions) => quadAt(bytes, positions));
    }
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return [quad(bytes.slice(2, 6))];
  return [];
}
