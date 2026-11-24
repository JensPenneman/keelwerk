import type { ApiSurface, HttpContext, LiveFrame, StateToken } from '@keelwerk/core';
import {
  asksForEventStream,
  coreError,
  decodeActionInput,
  encodeFrames,
} from '@keelwerk/core/http';
import type { RestHandlerDeps } from '../rest-handler-deps.ts';
import type { RestRoute } from '../rest-route.ts';
import { subscriptionInputOf } from './subscription-input-of.ts';

/**
 * A subscription route (16.5.1, 15.4.6, 15.4.8): the host's server-sent event stream on the route's
 * own path. Without `ctx.serveStream` the answer is `core.live_unavailable` when the request asks for
 * an event stream (the app has no live carrier) and `core.malformed_request` when it does not; `HEAD`
 * is `core.malformed_request`. The invoker subscribes under the host's session and its first frame is
 * awaited, so a refusal of the setup (input, token, policy) answers as a problem with its status; a
 * failure after that is the carrier's `error` event. The iterator the host's carrier reads aborts the
 * invocation first in `return()`, so a carrier that closes with a `next()` pending never waits for the
 * next change.
 */
export async function serveSubscription(
  deps: RestHandlerDeps,
  surface: ApiSurface,
  request: Request,
  ctx: HttpContext,
  route: RestRoute,
): Promise<Response> {
  if (request.method === 'HEAD') {
    throw coreError('core.malformed_request', {
      message: 'A subscription is opened with GET and Accept: text/event-stream.',
    });
  }
  const { serveStream } = ctx;
  if (serveStream === undefined) {
    throw asksForEventStream(request)
      ? coreError('core.live_unavailable')
      : coreError('core.malformed_request', {
          message: 'Send Accept: text/event-stream to open a subscription.',
        });
  }
  const { action } = route;
  const asked = subscriptionInputOf(route, request);
  const input = decodeActionInput(surface, action, asked.input);
  const inner = new AbortController();
  const abort = (): void => inner.abort();
  if (ctx.signal.aborted) abort();
  else ctx.signal.addEventListener('abort', abort, { once: true });
  const release = (): void => ctx.signal.removeEventListener('abort', abort);
  let iterator: AsyncIterator<LiveFrame<unknown>>;
  let first: IteratorResult<LiveFrame<unknown>>;
  try {
    const frames = encodeFrames(
      deps.invoker.subscribe<unknown, unknown>(
        {
          action: action.ref,
          input,
          carrier: { ...ctx.carrier, transport: 'rest' },
          session: ctx.session,
          requestId: ctx.requestId,
          ...(ctx.traceparent !== undefined && { traceparent: ctx.traceparent }),
          signal: inner.signal,
        },
        asked.after === undefined ? undefined : { after: asked.after as StateToken },
      ),
      action,
    );
    iterator = frames[Symbol.asyncIterator]();
    first = await iterator.next();
  } catch (failure) {
    abort();
    release();
    throw failure;
  }
  let waiting: IteratorResult<LiveFrame<unknown>> | undefined = first;
  let finished = false;
  const stop = async (): Promise<IteratorResult<LiveFrame<unknown>>> => {
    finished = true;
    abort();
    release();
    await iterator.return?.(undefined);
    return { done: true, value: undefined };
  };
  const source: AsyncIterator<LiveFrame<unknown>> = {
    async next() {
      if (finished) return { done: true, value: undefined };
      try {
        const step = waiting ?? (await iterator.next());
        waiting = undefined;
        if (step.done === true) return await stop();
        return step;
      } catch (failure) {
        await stop().catch(() => undefined);
        throw failure;
      }
    },
    return: stop,
  };
  try {
    return serveStream(
      { [Symbol.asyncIterator]: () => source },
      { action, surfaceHash: surface.hash },
    );
  } catch (failure) {
    // The host could not start the response: the subscription must not outlive the request.
    await stop().catch(() => undefined);
    throw failure;
  }
}
