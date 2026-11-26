import { endReasonOfError, type KeelwerkError } from '@keelwerk/core';
import { closeCodeOfError } from '@keelwerk/core/http';
import type { LiveSocketState } from './live-socket-state.ts';
import { socketWireError } from './socket-wire-error.ts';

/**
 * What `keelwerk.live.v1` does when the session no longer holds: `end` frames or an `error` frame, then
 * the close, written by the ending itself in one turn (the connection refuses every other send from then on).
 */
export function closeAfterRefusal(state: LiveSocketState): (error: KeelwerkError) => Promise<void> {
  return (error) => {
    if (endReasonOfError(error) === 'version_retired') {
      // The floor passed the socket's version: every subscription ends as a finished one, then the socket closes (15.4.6).
      const frames = [...state.subscriptions.keys()].map((id) =>
        JSON.stringify({ type: 'end', id, reason: 'version_retired' }),
      );
      state.open.closeWith(1000, 'version_retired', frames);
      for (const entry of state.subscriptions.values()) entry.abort.abort();
      return Promise.resolve();
    }
    const frame = JSON.stringify({ type: 'error', error: socketWireError(state, error) });
    state.open.closeWith(closeCodeOfError(error.kind), error.code, [frame]);
    return Promise.resolve();
  };
}
