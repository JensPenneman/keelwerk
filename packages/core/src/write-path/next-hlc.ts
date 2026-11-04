import { errors } from '../errors/errors.ts';
import type { Hlc } from '../events/hlc.ts';

/**
 * The authoring clock reading of the n-th event of an invocation (section 14.5.3): 12 hexadecimal
 * digits of the instant's milliseconds, 4 of the counter, a hyphen and the node id. Sortable as
 * text. A counter beyond 0xffff does not fit the 4 digits and fails the command.
 */
export function nextHlc(instant: Temporal.Instant, counter: number, nodeId: string): Hlc {
  if (counter > 0xffff) {
    throw errors.internal(
      'a command wrote more than 65536 events, which the clock reading cannot count',
    );
  }
  const wall = instant.epochMilliseconds.toString(16).padStart(12, '0');
  return `${wall}${counter.toString(16).padStart(4, '0')}-${nodeId}` as Hlc;
}
