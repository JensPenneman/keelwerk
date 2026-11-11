import type { LiveFrame } from '@keelwerk/core';
import { sseEventOf } from '@keelwerk/core';

/**
 * One frame as a server-sent event (15.4.6). An item is a `data` event whose `id` is its token, so
 * `Last-Event-ID` names the last position the client holds; `head` and a `reset` with a state carry
 * theirs, a `reset` without one writes no id line (the browser keeps the position it holds); a `gap` carries none.
 */
export function sseFrameOf(frame: LiveFrame<unknown>): string {
  if (!('control' in frame)) return sseEventOf('data', frame.event, frame.state);
  switch (frame.control) {
    case 'head':
      return sseEventOf('head', { state: frame.state }, frame.state);
    case 'reset':
      return sseEventOf(
        'reset',
        { reason: frame.reason, ...(frame.state === undefined ? {} : { state: frame.state }) },
        frame.state,
      );
    case 'gap':
      return sseEventOf('gap', frame.missed === undefined ? {} : { missed: frame.missed });
  }
}
