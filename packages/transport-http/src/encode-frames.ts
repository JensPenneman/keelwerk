import type { LiveFrame, SurfaceAction } from '@keelwerk/core';
import { asKeelwerkError, keepMasked } from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';

/**
 * The frames of a subscription as the wire shows them: an item is the action's output node applied to
 * its event (`toWire`, the `$masked` member kept), a control frame passes unchanged. An item that
 * cannot be encoded ends the stream with an internal error, so nothing leaves without its wire
 * encoding. The invoker has translated each item for the stream's API version already.
 */
export async function* encodeFrames(
  frames: AsyncIterable<LiveFrame<unknown>>,
  action: SurfaceAction,
): AsyncGenerator<LiveFrame<unknown>> {
  for await (const frame of frames) {
    if ('control' in frame) {
      yield frame;
      continue;
    }
    let event: unknown;
    try {
      event = keepMasked(action.output, frame.event, toWire(action.output, frame.event));
    } catch (failure) {
      throw asKeelwerkError(failure);
    }
    yield frame.state === undefined ? { event } : { event, state: frame.state };
  }
}
