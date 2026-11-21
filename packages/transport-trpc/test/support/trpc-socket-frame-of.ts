import type { ApiSurface } from '@keelwerk/core';
import type { StreamFrame } from '@keelwerk/testing';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import { trpcFrameOf } from './trpc-subscribe-over.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function revived(node: unknown): unknown {
  return isRecord(node) && 'json' in node ? keelwerkSuperjson().deserialize(node as never) : node;
}

/**
 * The suite's frame of one message tRPC's socket handler sent for a subscription: `started` and
 * `stopped` carry none; an error is the error frame; a `data` result is read as a server-sent event
 * is: a tracked one has `result.id` and `result.data = { id, data: frame }` with the same id, an
 * untracked one has the frame itself, and `trpcFrameOf` then holds the one frame rule.
 */
export function trpcSocketFrameOf(
  message: unknown,
  surface: ApiSurface,
  ref: string,
): StreamFrame | undefined {
  if (!isRecord(message))
    throw new Error(`A malformed socket message: ${JSON.stringify(message)}.`);
  if (isRecord(message.error)) {
    return trpcFrameOf(
      { event: 'serialized-error', id: undefined, data: message.error },
      surface,
      ref,
    );
  }
  const result = message.result;
  if (!isRecord(result) || result.type !== 'data') return undefined;
  const id = typeof result.id === 'string' ? result.id : undefined;
  let frame = result.data;
  if (id !== undefined) {
    const wrapper = revived(result.data);
    if (!isRecord(wrapper) || wrapper.id !== id || !('data' in wrapper)) {
      throw new Error('A tracked message needs the wrapper { id, data } with the id of result.id.');
    }
    frame = wrapper.data;
  }
  return trpcFrameOf({ event: 'message', id: id ?? '', data: frame }, surface, ref);
}
