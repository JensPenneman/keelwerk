/** One IPv6 network (a /64) is one client, as one host holds the whole range; an IPv4 address is its own. */
export function addressBucketOf(address: string): string {
  const bare = address.split('%')[0] ?? address;
  if (!bare.includes(':')) return bare;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped?.[1] !== undefined) return mapped[1];
  const halves = bare.split('::');
  if (halves.length > 2) return address;
  const groups = (text: string | undefined): string[] =>
    text === undefined || text === ''
      ? []
      : text.split(':').flatMap((group) => (group.includes('.') ? ['0', '0'] : [group]));
  const head = groups(halves[0]);
  const tail = groups(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return address;
  const full =
    halves.length === 1 ? head : [...head, ...new Array<string>(missing).fill('0'), ...tail];
  const prefix = full.slice(0, 4).map((group) => Number.parseInt(group, 16));
  if (prefix.some((group) => Number.isNaN(group))) return address;
  return `${prefix.map((group) => group.toString(16)).join(':')}::/64`;
}
