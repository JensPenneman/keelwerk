import type { LiveFrame, StateToken, SurfaceAction } from '@keelwerk/core';
import { ClientError } from './client-error.ts';
import { clientFailure } from './client-failure.ts';
import { decodeWithSurface } from './decode-with-surface.ts';
import { encodeActionInput } from './encode-action-input.ts';
import { errorOfEnvelope } from './error-of-envelope.ts';
import type { LiveLeg } from './live-leg.ts';
import type { RemoteClientState } from './remote-client-state.ts';
import { resumeFrames } from './resume-frames.ts';
import { openSseLeg } from './sse/open-sse-leg.ts';
import type { LoadedSurface } from './surface-cache.ts';
import { openSocketLeg } from './websocket/open-socket-leg.ts';

async function startOf(
  state: RemoteClientState,
  ref: string,
  input: unknown,
  options: { readonly after?: StateToken; readonly signal?: AbortSignal },
): Promise<{ readonly action: SurfaceAction; readonly frames: AsyncIterator<LiveFrame<unknown>> }> {
  const loaded: LoadedSurface = await state.surfaces.get();
  const action = loaded.actions.get(ref);
  if (action === undefined || action.kind !== 'subscription') {
    throw clientFailure('core.not_found', `The surface has no subscription ${ref}.`);
  }
  const wireInput = encodeActionInput(loaded.surface, action, input);
  const leg: LiveLeg = state.live === 'websocket' ? openSocketLeg(state) : openSseLeg(state);
  const frames = resumeFrames(
    leg,
    { action: ref, ...(wireInput !== undefined && { input: wireInput }) },
    {
      ...(options.after !== undefined && { after: options.after }),
      ...(options.signal !== undefined && { signal: options.signal }),
      retry: state.retry,
      // A reopen refused as `rate_limited` finds the host still holding the slot of the dead connection.
      dropped: (failure) =>
        !(failure instanceof ClientError) ||
        failure.code === 'core.unavailable' ||
        failure.kind === 'rate_limited',
      failure: (error) => errorOfEnvelope({ ok: false, error }, 200, loaded),
    },
  );
  return { action, frames: frames[Symbol.asyncIterator]() };
}

/**
 * `AppClient.subscribe`: the surface is loaded on the first `next()`, the input encoded with it, the
 * subscription opened on the carrier of the connection (`live`, server-sent events by default) and
 * resumed from its last token when the connection drops (`resumeFrames`); each item is decoded with the
 * action's output. A ref that is not a subscription of the surface is `core.not_found`; a server
 * without the live module is `core.live_unavailable`.
 */
export function subscribeRemote(
  state: RemoteClientState,
  ref: string,
  input: unknown,
  options: { readonly after?: StateToken; readonly signal?: AbortSignal },
): AsyncIterable<LiveFrame<unknown>> {
  const iterate = (): AsyncIterator<LiveFrame<unknown>> => {
    let started: ReturnType<typeof startOf> | undefined;
    let closed = false;
    return {
      async next() {
        if (closed) return { done: true, value: undefined };
        started ??= startOf(state, ref, input, options);
        const { action, frames } = await started;
        const step = await frames.next();
        if (step.done === true) return step;
        const frame = step.value;
        if ('control' in frame) return { done: false, value: frame };
        return {
          done: false,
          value: {
            ...frame,
            event: decodeWithSurface(action.output, frame.event, `an item of ${ref}`),
          },
        };
      },
      async return() {
        closed = true;
        if (started !== undefined) {
          const { frames } = await started.catch(() => ({ frames: undefined }));
          await frames?.return?.(undefined);
        }
        return { done: true, value: undefined };
      },
    };
  };
  return { [Symbol.asyncIterator]: iterate };
}
