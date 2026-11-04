function sorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sorted);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, member]) => [key, sorted(member)]),
    );
  }
  return value;
}

/** The generated JSON form of section 13.7: sorted keys, two-space indentation, LF line endings and a trailing newline. */
export function renderJson(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}
