import type { LiveFrame, LiveServerMessage } from '@keelwerk/core';

function messageOf(id: string, frame: LiveFrame<unknown>): LiveServerMessage {
  if (!('control' in frame)) {
    return frame.state === undefined
      ? { type: 'data', id, item: frame.event }
      : { type: 'data', id, state: frame.state, item: frame.event };
  }
  switch (frame.control) {
    case 'head':
      return { type: 'head', id, state: frame.state };
    case 'reset':
      return frame.state === undefined
        ? { type: 'reset', id, reason: frame.reason }
        : { type: 'reset', id, reason: frame.reason, state: frame.state };
    case 'gap':
      return frame.missed === undefined
        ? { type: 'gap', id }
        : { type: 'gap', id, missed: frame.missed };
  }
}

/**
 * One frame as the JSON text of a `LiveServerMessage` under the subscription's `id` (15.4.7): an item
 * is `data` (with its state when the frame has one), `head`, `reset` (with its state when it has one)
 * and `gap` carry their members.
 */
export function websocketMessageOf(id: string, frame: LiveFrame<unknown>): string {
  return JSON.stringify(messageOf(id, frame));
}
