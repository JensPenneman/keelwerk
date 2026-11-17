import { isKweEnvelope } from '../encryption/is-kwe-envelope.ts';
import type { ProcessStateRecord } from './process-state-record.ts';

/**
 * A stored record when it is a valid `ProcessStateRecord` built from `from`; `undefined` for
 * anything else: another `v`, another `from`, a version that is no integer of at least 1, a hash
 * that is neither text nor null, both or neither of `text` and `sealed`, a `text` that is no string
 * and a `sealed` member that is no `$kwe` envelope. A cache is derived data, so a record that does not read is no cache, and
 * this never throws.
 */
export function processStateRecordOf(value: unknown, from: string): ProcessStateRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const stored = value as Readonly<Record<string, unknown>>;
  if (stored.v !== 1 || stored.from !== from) return undefined;
  const { version, hash } = stored;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined;
  if (hash !== null && typeof hash !== 'string') return undefined;
  const plain = Object.hasOwn(stored, 'text');
  const sealed = Object.hasOwn(stored, 'sealed');
  if (plain === sealed) return undefined;
  if (plain) {
    return typeof stored.text === 'string'
      ? { v: 1, from, version, hash, text: stored.text }
      : undefined;
  }
  if (!isKweEnvelope(stored.sealed)) return undefined;
  const { k, n, c } = stored.sealed;
  return { v: 1, from, version, hash, sealed: { $kwe: 1, k, n, c } };
}
