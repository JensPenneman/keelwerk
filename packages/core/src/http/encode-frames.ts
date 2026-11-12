import type { LiveFrame } from '../invoker/live-frame.ts';
import type { SurfaceAction } from '../surface/surface-action.ts';
import { encodeFrame } from './encode-frame.ts';

/**
 * The frames of a subscription as the wire shows them (`encodeFrame`): an item that cannot be
 * encoded ends the stream with an internal error. The invoker has translated each item for the
 * stream's API version already.
 */
export async function* encodeFrames(
  frames: AsyncIterable<LiveFrame<unknown>>,
  action: SurfaceAction,
): AsyncGenerator<LiveFrame<unknown>> {
  for await (const frame of frames) yield encodeFrame(frame, action);
}
