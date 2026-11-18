import { canonicalizeJson } from '@keelwerk/core';

function plain(value: unknown): unknown {
  // An integer is the same partition whether it arrives as a number or a bigint.
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Temporal.Instant || value instanceof Temporal.PlainDate) {
    return value.toString();
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64url');
  if (value instanceof Set) return [...value].map(plain).sort();
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

/** The text a `kw_serials.partition` holds: the canonical JSON of the `per` values, integers alike whatever their type. */
export function serialPartition(partition: readonly unknown[]): string {
  return canonicalizeJson(partition.map(plain));
}
