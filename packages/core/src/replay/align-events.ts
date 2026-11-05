import { alignSealedValues } from '../encryption/align-sealed-values.ts';
import { alignInstants } from './align-instants.ts';
import type { ComparableEvent } from './comparable-event.ts';

/**
 * The re-decided events lined up with the recorded ones where a re-decide cannot reproduce a
 * value exactly: sealed values (every sealing draws a fresh nonce) and instants finer than the
 * store keeps.
 */
export function alignEvents(
  redecided: readonly ComparableEvent[],
  base: readonly ComparableEvent[],
): readonly ComparableEvent[] {
  return redecided.map((event, index) => ({
    ...event,
    data: alignInstants(base[index]?.data, alignSealedValues(base[index]?.data, event.data)),
    before: alignInstants(
      base[index]?.before,
      alignSealedValues(base[index]?.before, event.before),
    ),
  }));
}
