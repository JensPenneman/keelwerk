import type { SurfaceAction } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { CliFailure } from '../context/cli-failure.ts';
import { deprecationWarning } from './deprecation-warning.ts';

/**
 * A subscription command (16.9.5): every item is one line of NDJSON, `{"state","item"}` (`state` left
 * out when the item has none), through `output.line`. It stops at the first `head`, which ends the
 * changes up to now, unless `follow` is set or the action is a generated `watch`, which always
 * follows. A reset the client could not repair by itself (`resync`, `expired`) is a note on standard
 * error: the subscription starts again from now (a generated watch reopens without a token), so what
 * changed between the reset and the reopen is not printed and the caller queries again (15.4.4). The stream ending `complete` is exit 0; an interrupt is exit 130.
 */
export async function followSubscription(
  context: CliContext,
  action: SurfaceAction,
  input: unknown,
  follow: boolean,
): Promise<void> {
  const { output } = context;
  const stopsAtHead = !follow && action.generated !== 'watch';
  const frames = context.client.subscribe(action.ref, input, {
    signal: context.signal,
    onDeprecation: (notice) => output.note(deprecationWarning(notice)),
  });
  for await (const frame of frames) {
    if (!('control' in frame)) {
      output.line(
        JSON.stringify({
          ...(frame.state !== undefined && { state: frame.state }),
          item: frame.event,
        }),
      );
    } else if (frame.control === 'head') {
      if (stopsAtHead) break;
    } else if (frame.control === 'reset') {
      output.note(
        `note: the subscription was reset (${frame.reason}) and starts again from now; changes before now may be missing, so query again.`,
      );
    }
  }
  if (context.signal.aborted) throw new CliFailure('interrupted', 'Interrupted.');
}
