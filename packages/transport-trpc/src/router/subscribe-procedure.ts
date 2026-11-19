import type { LiveFrame, StateToken, SurfaceAction } from '@keelwerk/core';
import { asKeelwerkError, decodeActionInput, encodeFrames, signalOf } from '@keelwerk/core/http';
import { tracked } from '@trpc/server';
import { trpcErrorOf } from '../errors/trpc-error-of.ts';
import { superjsonValueOf } from '../transformer/superjson-value-of.ts';
import { superjsonWireOf } from '../transformer/superjson-wire-of.ts';
import type { TrpcContext } from './trpc-context.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The raw input of a subscription without `lastEventId`, which tRPC merges into it, and the token to resume after. */
function resumeOf(
  action: SurfaceAction,
  raw: unknown,
): { readonly rest: unknown; readonly after?: StateToken } {
  if (!isRecord(raw) || !Object.hasOwn(raw, 'lastEventId')) return { rest: raw };
  const { lastEventId, ...others } = raw;
  const rest =
    action.input.kind === 'void' && Object.keys(others).length === 0 ? undefined : others;
  return typeof lastEventId === 'string' && lastEventId !== ''
    ? { rest, after: lastEventId as StateToken }
    : { rest };
}

/**
 * What one frame of the invoker is on the wire: exactly one contract frame (section 16.7.5), never
 * the bare event. An item is `{ data: event }`, with `id` (its state) for an item of a resumable
 * action that carries one, and then `tracked(state, item)`; `head`, and a `reset` with a state, are
 * `tracked(state, control)`; `gap` and a `reset` without a state go out untracked. The id of
 * `tracked` comes only from the state of the frame, never from an event. An event with no value
 * (the `void` output of an empty shape) is `undefined`, which superjson keeps but the plain json
 * wire drops with its member, so under `transformer: 'json'` it is written as `null` and the item
 * still has its `data`.
 */
function messageOf(
  context: TrpcContext,
  action: SurfaceAction,
  frame: LiveFrame<unknown>,
): unknown {
  const state = 'state' in frame ? frame.state : undefined;
  const resumeAt = action.resumable && state !== undefined && state !== '' ? state : undefined;
  if ('control' in frame) return resumeAt === undefined ? frame : tracked(resumeAt, frame);
  const event =
    context.transformer === 'superjson'
      ? superjsonValueOf(action.output, frame.event)
      : (frame.event ?? null);
  return resumeAt === undefined
    ? { data: event }
    : tracked(resumeAt, { data: event, id: resumeAt });
}

/**
 * The generator of a subscription procedure (section 16.7.1): the raw input becomes the wire input
 * without `lastEventId`, which is the token to resume after, and is decoded once by core. Each frame
 * of the invoker is wire encoded and yielded as one contract frame (`messageOf`), so the client's
 * own resume sends the last state token back. A failure ends the stream as the `TRPCError` of its
 * kind. The invocation stops with `signal`, which tRPC aborts when the response body is cancelled.
 */
export async function* subscribeProcedure(
  context: TrpcContext,
  action: SurfaceAction,
  raw: unknown,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  try {
    const { rest, after } = resumeOf(action, raw);
    const wire = context.transformer === 'superjson' ? superjsonWireOf(action.input, rest) : rest;
    const input = decodeActionInput(context.surface, action, wire);
    const frames = encodeFrames(
      context.invoker.subscribe<unknown, unknown>(
        {
          action: action.ref,
          input,
          carrier: { ...context.carrier, transport: 'trpc' },
          session: context.session,
          requestId: context.requestId,
          ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
          signal: signalOf(action, signal),
        },
        after === undefined ? undefined : { after },
      ),
      action,
    );
    for await (const frame of frames) yield messageOf(context, action, frame);
  } catch (thrown) {
    const error = asKeelwerkError(thrown);
    throw trpcErrorOf(error);
  }
}
