import type { LiveFrame, StateToken, StreamControl, SurfaceAction } from '@keelwerk/core';
import { asKeelwerkError, decodeActionInput, encodeFrames } from '@keelwerk/core/http';
import { withEventMeta } from '@orpc/server';
import { orpcErrorOf } from '../errors/orpc-error-of.ts';
import type { OrpcStreamItem } from '../orpc-stream-item.ts';
import { nativeOfWire } from '../wire/native-of-wire.ts';
import { wireOfNative } from '../wire/wire-of-native.ts';
import type { OrpcContext } from './orpc-context.ts';

/**
 * A control frame rebuilt with its declared members only, so a member that a hub or a source adds
 * (a `data` member in particular) never reaches the wire: a reader tells a control frame from an
 * item by the absence of `data`.
 */
function controlFrameOf(frame: StreamControl): StreamControl {
  switch (frame.control) {
    case 'head':
      return { control: 'head', state: frame.state };
    case 'reset':
      return {
        control: 'reset',
        reason: frame.reason,
        ...(frame.state === undefined ? {} : { state: frame.state }),
      };
    case 'gap':
      return { control: 'gap', ...(frame.missed === undefined ? {} : { missed: frame.missed }) };
  }
}

/**
 * The frame a live frame is on the wire. An item is `{ data }`, or `{ data, id }` when it has a
 * state: `data` is the event in the serialiser's types and `id` the stream token, which is also the
 * event id, whatever the event is. A head, and a reset that has a state, are the control frame with
 * that state as the event id, as the host's own SSE writes them; a reset without a state and a gap
 * are the control frame alone, with no id. The envelope is always an object, so an event of any
 * kind, a member named `control` included, stays inside `data` and is never read as a control frame.
 */
function eventOf(
  context: OrpcContext,
  action: SurfaceAction,
  frame: LiveFrame<unknown>,
): OrpcStreamItem<unknown> | StreamControl {
  if ('control' in frame) {
    const control = controlFrameOf(frame);
    if (control.control === 'gap' || control.state === undefined) return control;
    return withEventMeta(control, { id: control.state });
  }
  const data = context.wire === 'orpc' ? nativeOfWire(action.output, frame.event) : frame.event;
  return frame.state === undefined
    ? { data }
    : withEventMeta({ data, id: frame.state }, { id: frame.state });
}

/**
 * The event iterator of a subscription (section 16.7.7): the input is decoded, the invoker
 * subscribes under the request's session, resuming after `lastEventId` (the `Last-Event-ID` of the
 * request), and its frames are wire encoded and wrapped as `eventOf` says. The first frame is
 * awaited before this returns, so a refusal (a malformed token, a forbidden subscription) is thrown
 * as an oRPC error and answers as an HTTP error, not as a stream. A failure of a later frame ends
 * the stream with an oRPC error. The iterator's `return` aborts the invocation first, so the
 * iterator of the invoker is free to return. A `reset` is the last frame this iterator gives,
 * whatever the source does after it: the reset goes out at once, the invocation is aborted and
 * released and the source is returned without waiting for it, and the next `next` is done.
 */
export async function subscribeProcedure(
  context: OrpcContext,
  action: SurfaceAction,
  wire: unknown,
  lastEventId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<AsyncIteratorObject<OrpcStreamItem<unknown> | StreamControl, void, void>> {
  context.answer.entered = true;
  const inner = new AbortController();
  const abort = (): void => inner.abort();
  const sources = [context.signal, ...(signal === undefined ? [] : [signal])];
  for (const source of sources) {
    if (source.aborted) abort();
    else source.addEventListener('abort', abort, { once: true });
  }
  const release = (): void => {
    for (const source of sources) source.removeEventListener('abort', abort);
  };
  let iterator: AsyncIterator<LiveFrame<unknown>>;
  let first: IteratorResult<LiveFrame<unknown>>;
  try {
    const input = decodeActionInput(
      context.surface,
      action,
      action.input.kind === 'void' ? undefined : wireOfNative(wire),
    );
    const frames = encodeFrames(
      context.invoker.subscribe<unknown, unknown>(
        {
          action: action.ref,
          input,
          carrier: { ...context.carrier, transport: 'orpc' },
          session: context.session,
          requestId: context.requestId,
          ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
          signal: inner.signal,
        },
        lastEventId === undefined ? undefined : { after: lastEventId as StateToken },
      ),
      action,
    );
    iterator = frames[Symbol.asyncIterator]();
    first = await iterator.next();
    if (action.deprecated !== undefined) context.answer.deprecated = action.deprecated;
  } catch (thrown) {
    abort();
    release();
    throw orpcErrorOf(asKeelwerkError(thrown), context);
  }
  let waiting: IteratorResult<LiveFrame<unknown>> | undefined = first;
  let finished = false;
  let returning: Promise<void> | undefined;
  const stop = async (): Promise<IteratorResult<OrpcStreamItem<unknown> | StreamControl, void>> => {
    finished = true;
    abort();
    release();
    if (returning === undefined) await iterator.return?.(undefined);
    else await returning;
    return { done: true, value: undefined };
  };
  const source: AsyncGenerator<OrpcStreamItem<unknown> | StreamControl, void, void> = {
    async next() {
      if (finished) {
        await returning;
        return { done: true, value: undefined };
      }
      try {
        const step = waiting ?? (await iterator.next());
        waiting = undefined;
        if (step.done === true) return await stop();
        const frame = eventOf(context, action, step.value);
        if ('control' in frame && frame.control === 'reset') {
          finished = true;
          abort();
          release();
          returning = (async () => {
            await iterator.return?.(undefined);
          })().catch(() => undefined);
        }
        return { done: false, value: frame };
      } catch (thrown) {
        const error = orpcErrorOf(asKeelwerkError(thrown), context);
        await stop();
        throw error;
      }
    },
    return: stop,
    async throw(failure: unknown) {
      await stop();
      throw failure;
    },
    [Symbol.asyncIterator]() {
      return source;
    },
    async [Symbol.asyncDispose]() {
      await stop();
    },
  };
  return source;
}
