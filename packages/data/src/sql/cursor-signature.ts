import type { Condition } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';

/** Maps the values JSON cannot hold to tagged objects, so `1n`, `1` and `'1'` stay apart. */
function jsonOf(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'bigint':
      return { $bigint: String(value) };
    case 'object':
      break;
    default:
      return value;
  }
  if (Array.isArray(value)) return value.map(jsonOf);
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('hex') };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof Set) {
    return { $set: [...value].map((member) => canonicalizeJson(jsonOf(member))).sort() };
  }
  if (value instanceof Temporal.Instant || value instanceof Temporal.PlainDate) {
    return { $temporal: value.toString() };
  }
  const mapped: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(value)) {
    if (member !== undefined) mapped[name] = jsonOf(member);
  }
  return mapped;
}

/**
 * The short hash a cursor carries (section 14.3.5): 8 bytes of the SHA-256 of the sort and the
 * filter, in base64url. A cursor reused with another sort or filter does not match. The scope
 * predicate and the paging arguments are not part of it.
 */
export function cursorSignature(
  sort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[],
  where: Condition | undefined,
): string {
  const text = canonicalizeJson(
    jsonOf({ sort: sort.map((key) => [key.field, key.direction]), where: where ?? null }),
  );
  return Buffer.from(sha256(text), 'hex').subarray(0, 8).toString('base64url');
}
