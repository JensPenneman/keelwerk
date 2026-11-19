import type { StreamControl } from '@keelwerk/core';
import type { TrpcStreamItem } from './trpc-stream-item.ts';

/**
 * What a subscription's `onData` receives (section 16.7.5): every message of the stream holds exactly
 * one contract frame, an item (`{ data }`, with `id` for an item that carries a state) or a control
 * frame (`{ control }` and no `data`), and never the bare event. A frame that carries a state token
 * (an item of a resumable action, `head`, and a `reset` with a state) is tracked, so tRPC's client
 * hands it over as `{ id, data: <frame> }` and resumes from that `id`; the other frames arrive as
 * they are. A reader unwraps a value that has a string `id`, once, and then narrows what remains
 * with `'data' in frame`: an item, else a control frame. An event with no value (a `void` output)
 * arrives as `null` when the app sets `transformer: 'json'`, so the item keeps its `data`.
 */
export type TrpcFrame<O> =
  | { readonly id: string; readonly data: TrpcStreamItem<O> | StreamControl }
  | { readonly data: O }
  | StreamControl;
