function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** GraphQL nulls are absent (16.4.2) and a non-empty `_masked` is the `$masked` member of the row. */
export function cleaned(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleaned);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (key === '_masked') {
      if (Array.isArray(member) && member.length > 0) out.$masked = member;
    } else if (member !== null && key !== '__typename') {
      out[key] = cleaned(member);
    }
  }
  return out;
}
