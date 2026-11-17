/**
 * A value as JSON text would carry it: instants and bigints as strings, the random ids of events
 * named by `ids`.
 */
export function plainJsonValue(
  value: unknown,
  ids: ReadonlyMap<string, string> = new Map(),
): unknown {
  const text = JSON.stringify(value, (_key, member: unknown) => {
    if (typeof member === 'bigint') return `${member}n`;
    if (typeof member === 'string') return ids.get(member) ?? member;
    return member;
  });
  return JSON.parse(text);
}
