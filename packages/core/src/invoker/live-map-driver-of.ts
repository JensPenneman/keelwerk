import { driveHandler } from '../interpreter/drive-handler.ts';
import { runReadUnit } from '../interpreter/run-read-unit.ts';
import type { RunReadUnitInput } from '../interpreter/run-read-unit-input.ts';
import type { LiveMapDriver } from '../live/live-map-driver.ts';

/**
 * Runs one read-only unit of the subscription's target per generator item, with the `authorities`
 * the source context registered its requests under. The principal and the flags are read again for
 * every item from `subject`, which the hub's renewal updates, so a map never loads under what the
 * subscriber has since lost (15.4.3 step 5). The unit ends when `invocation` aborts or when the
 * stream does. A yield that is not a request is `core.request_not_allowed`; a failed answer ends the stream.
 */
export function liveMapDriverOf(
  input: Omit<RunReadUnitInput, 'principal' | 'flags' | 'signal'>,
  subject: () => Pick<RunReadUnitInput, 'principal' | 'flags'>,
  invocation: AbortSignal,
): LiveMapDriver {
  return async (generator, stopped) => {
    const result = await runReadUnit(
      {
        ...input,
        ...subject(),
        signal: stopped === undefined ? invocation : AbortSignal.any([invocation, stopped]),
      },
      (_handler, answer) => driveHandler(generator, answer),
    );
    return result.output;
  };
}
