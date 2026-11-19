import type { QuotaKind } from '../dsl/quota.ts';
import { durationMs } from '../effects/duration-ms.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { QuotaLimit } from './quota-limit.ts';

const byteUnits: ReadonlyMap<string, number> = new Map([
  ['B', 1],
  ['KiB', 1024],
  ['MiB', 1024 ** 2],
  ['GiB', 1024 ** 3],
  ['TiB', 1024 ** 4],
]);

function refuse(kind: QuotaKind, value: string | number, why: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'validation',
    code: 'core.malformed_request',
    message: `${JSON.stringify(value)} is not a ${kind} quota: ${why}.`,
  });
}

/** A whole number at or above zero, from a number or from digits. */
function wholeNumber(kind: QuotaKind, value: string | number): number {
  const number =
    typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw refuse(kind, value, 'use a whole number at or above zero');
  }
  return number;
}

function parseBytes(value: string | number): QuotaLimit {
  if (typeof value === 'string') {
    const unit = /^(\d+(?:\.\d+)?)(B|KiB|MiB|GiB|TiB)$/.exec(value);
    const size = byteUnits.get(unit?.[2] ?? '');
    if (unit !== null && size !== undefined) {
      const bytes = Math.floor(Number(unit[1]) * size);
      if (!Number.isSafeInteger(bytes)) throw refuse('bytes', value, 'the size is too large');
      return { kind: 'bytes', value: bytes };
    }
  }
  return { kind: 'bytes', value: wholeNumber('bytes', value) };
}

function parseRate(value: string | number): QuotaLimit {
  const parts = typeof value === 'string' ? /^(\d+)\/(.+)$/.exec(value) : null;
  const countText = parts?.[1];
  const periodText = parts?.[2];
  if (countText === undefined || periodText === undefined) {
    throw refuse('rate', value, "use '<count>/<period>' such as '100/1m'");
  }
  const count = Number(countText);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw refuse('rate', value, 'the count must be a whole number of at least 1');
  }
  let periodMs: number;
  try {
    // The canonical form of a stored rate ('<count>/<milliseconds>ms') never depends on durationMs.
    periodMs = /^\d+ms$/.test(periodText)
      ? Number.parseInt(periodText, 10)
      : durationMs(periodText);
  } catch (error) {
    const why = error instanceof Error ? error.message.replace(/\.$/, '') : 'the period is invalid';
    throw refuse('rate', value, why);
  }
  if (!Number.isSafeInteger(periodMs) || periodMs < 1) {
    throw refuse(
      'rate',
      value,
      'the period must be a whole number of milliseconds from 1 to 9007199254740991',
    );
  }
  return { kind: 'rate', capacity: count, refillPerSecond: (count * 1000) / periodMs };
}

/**
 * A declared default or a stored limit as a resolved limit. Bytes take a whole number or
 * `<decimal><B|KiB|MiB|GiB|TiB>` (floored to whole bytes), counts a whole number at or above zero,
 * a rate `<count>/<period>` with a count of at least 1 and a period of a whole number of at least 1
 * millisecond (a token bucket of that capacity; the period is a duration, or exactly
 * `<milliseconds>ms`, the form `canonicalQuotaValue` stores). Anything else is a `validation`
 * error `core.malformed_request` naming the text and the kind.
 */
export function parseQuotaValue(kind: QuotaKind, value: string | number): QuotaLimit {
  if (kind === 'bytes') return parseBytes(value);
  if (kind === 'count') return { kind: 'count', value: wholeNumber('count', value) };
  return parseRate(value);
}
