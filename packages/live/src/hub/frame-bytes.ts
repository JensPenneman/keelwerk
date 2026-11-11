import type { LiveFrame } from '@keelwerk/core';

const encoder = new TextEncoder();

/** The part of a value a frame's JSON text keeps: a bigint as its decimal digits, bytes by their count of base64 characters, a set as a list. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return 'x'.repeat(Math.ceil(value.byteLength / 3) * 4);
  if (value instanceof Set) return [...value];
  return value;
}

/** The size a frame has on the wire: the UTF-8 length of its JSON text (a bigint as its decimal digits, a Temporal value as its text). */
export function frameBytes(frame: LiveFrame<unknown>): number {
  return encoder.encode(JSON.stringify(frame, replacer) ?? '').byteLength;
}
