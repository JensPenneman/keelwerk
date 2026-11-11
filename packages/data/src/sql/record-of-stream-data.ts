import { errors } from '@keelwerk/core';

function unreadable(): Error {
  return errors.internal('a stream record has a stored form this release does not read');
}

/**
 * The record inside stored `data` (an object, or its JSON text): the member `record` of an object
 * whose only other member may be `v`, a positive integer schema version that this release never
 * writes and ignores on read. Anything else, such as the reference record of a later release, is
 * `internal`: this release never reads it as data.
 */
export function recordOfStreamData(data: unknown): unknown {
  let value: unknown = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw unreadable();
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unreadable();
  const given = value as Readonly<Record<string, unknown>>;
  const extra = Object.keys(given).filter((member) => member !== 'record' && member !== 'v');
  if (!('record' in given) || extra.length > 0) throw unreadable();
  if ('v' in given && !(Number.isInteger(given.v) && (given.v as number) > 0)) throw unreadable();
  return (value as { readonly record: unknown }).record;
}
