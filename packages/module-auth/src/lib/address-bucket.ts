const hextets = 8;
const prefixHextets = 4;

/** The eight hextets of an IPv6 address, as numbers, or undefined when the text is not one. */
function expand(address: string): readonly number[] | undefined {
  const bare = address.split('%')[0] ?? address;
  if (!bare.includes(':') || !/^[0-9a-fA-F:.]+$/.test(bare) || bare.split('::').length > 2) {
    return undefined;
  }
  let text = bare;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted !== null) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${(((a ?? 0) << 8) | (b ?? 0)).toString(16)}:${(((c ?? 0) << 8) | (d ?? 0)).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = tail === undefined || tail === '' ? [] : tail.split(':');
  const gap = tail === undefined ? 0 : hextets - first.length - last.length;
  if (gap < 0 || (tail === undefined && first.length !== hextets)) return undefined;
  const parts = [...first, ...Array.from({ length: gap }, () => '0'), ...last].map((part) =>
    Number.parseInt(part, 16),
  );
  return parts.length === hextets && parts.every((part) => part >= 0 && part <= 0xffff)
    ? parts
    : undefined;
}

/**
 * The key an address is rate limited under (17.2.6): an IPv4 address as it is, an IPv6 address by
 * its /64 prefix, since one subscriber holds a whole /64 and could otherwise draw a fresh bucket
 * per request. An IPv4-mapped IPv6 address counts as the IPv4 address.
 */
export function addressBucket(address: string): string {
  const parts = expand(address);
  if (parts === undefined) return address;
  const mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (mapped) {
    const high = parts[6] ?? 0;
    const low = parts[7] ?? 0;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return `${parts
    .slice(0, prefixHextets)
    .map((part) => part.toString(16))
    .join(':')}::/64`;
}
