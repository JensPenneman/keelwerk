import { isKweEnvelope } from './is-kwe-envelope.ts';

/**
 * The key id (`k`) of every `$kwe` envelope, version 1 or 2, in a value: arrays and objects are
 * walked, an envelope is not entered. Distinct, in the order first seen.
 */
export function sealedKeyIds(value: unknown): readonly string[] {
  const ids = new Set<string>();
  const walk = (member: unknown): void => {
    if (isKweEnvelope(member)) {
      ids.add(member.k);
      return;
    }
    if (Array.isArray(member)) {
      for (const element of member) walk(element);
      return;
    }
    if (typeof member === 'object' && member !== null) {
      for (const element of Object.values(member)) walk(element);
    }
  };
  walk(value);
  return [...ids];
}
