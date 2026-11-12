import type { LiveFrame } from '../invoker/live-frame.ts';
import type { SurfaceAction } from '../surface/surface-action.ts';
import { toWire } from '../wire/to-wire.ts';
import { asKeelwerkError } from './as-keelwerk-error.ts';
import { keepMasked } from './keep-masked.ts';

/**
 * One frame of a subscription as the wire shows it: an item is the action's output node applied to
 * its event (`toWire`, the `$masked` member kept), a control frame passes unchanged. An item that
 * cannot be encoded is an internal error, so nothing leaves without its wire encoding.
 */
export function encodeFrame(frame: LiveFrame<unknown>, action: SurfaceAction): LiveFrame<unknown> {
  if ('control' in frame) return frame;
  let event: unknown;
  try {
    event = keepMasked(action.output, frame.event, toWire(action.output, frame.event));
  } catch (failure) {
    throw asKeelwerkError(failure);
  }
  return frame.state === undefined ? { event } : { event, state: frame.state };
}
