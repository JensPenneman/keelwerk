import type { EffectEntry } from '../registry/effect-entry.ts';
import { plainInputMembers } from './plain-input-members.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstSealed(plain: ReadonlySet<string>, where: unknown): string | undefined {
  if (!isRecord(where)) return undefined;
  for (const key of Object.keys(where)) {
    const value = where[key];
    if (key === 'and' || key === 'or') {
      if (!Array.isArray(value)) continue;
      for (const inner of value) {
        const found = firstSealed(plain, inner);
        if (found !== undefined) return found;
      }
    } else if (key === 'not') {
      const found = firstSealed(plain, value);
      if (found !== undefined) return found;
    } else {
      const member = key.split('.')[0] ?? key;
      if (!plain.has(member)) return member;
    }
  }
  return undefined;
}

/**
 * The first member an object-form `where` names (through `and`, `or`, `not`; the first segment of a
 * dotted key) that is not a plain input member of the effect; undefined when every one is. Reads
 * keys only, never values.
 */
export function sealedWhereMember(entry: EffectEntry, where: unknown): string | undefined {
  return firstSealed(new Set(plainInputMembers(entry)), where);
}
