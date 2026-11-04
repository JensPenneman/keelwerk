function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, member]): [string, unknown] => [key, sorted(member)]);
  return Object.fromEntries(entries);
}

/** Two-space JSON with every object's keys in UTF-16 order (the order of RFC 8785) and a trailing newline: the form of every generated artefact (section 13.7). */
export function sortedJson(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}
