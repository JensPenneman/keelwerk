import { isMemberRecord } from './is-member-record.ts';

function isPlain(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isMemberRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function maskedNames(row: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const names = row.$masked;
  return new Set(
    Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [],
  );
}

/**
 * The view of a shaped value for a custom output transform (section 16.4.5): a copy, at every
 * depth, in which a row that lists masked names no longer holds them, not even as a key. `$masked`
 * stays on the row. A value without a masked member is returned as it is.
 */
export function maskedView(value: unknown): unknown {
  if (Array.isArray(value)) {
    const built = value.map(maskedView);
    return built.some((entry, index) => entry !== value[index]) ? built : value;
  }
  if (!isPlain(value)) return value;
  const masked = maskedNames(value);
  let changed = false;
  const entries: [string, unknown][] = [];
  for (const [name, member] of Object.entries(value)) {
    if (name !== '$masked' && masked.has(name)) {
      changed = true;
      continue;
    }
    const built = maskedView(member);
    if (built !== member) changed = true;
    entries.push([name, built]);
  }
  return changed ? Object.fromEntries(entries) : value;
}
