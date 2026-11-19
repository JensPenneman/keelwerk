import type { ApiSurface, ErrorKind } from '@keelwerk/core';
import { statusOfError } from '@keelwerk/core/http';
import {
  type EventStreamReader,
  originOf,
  readEventStream,
  requestHeaders,
  type StreamFrame,
  type SubscribeCall,
  type TransportTarget,
} from '@keelwerk/testing';
import { trpcPathOf } from '../../src/router/trpc-path-of.ts';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import { superjsonValueOf } from '../../src/transformer/superjson-value-of.ts';
import { superjsonWireOf } from '../../src/transformer/superjson-wire-of.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the event data holds once tRPC's transformer is undone (the superjson values). */
function revived(parsed: unknown): unknown {
  return isRecord(parsed) && 'json' in parsed
    ? keelwerkSuperjson().deserialize(parsed as never)
    : parsed;
}

function malformed(why: string): never {
  throw new Error(`A malformed frame: ${why}.`);
}

/**
 * The suite's frame of one tRPC server-sent event; undefined for the events that carry none
 * (`connected`, `ping`, `return`) and for a control frame this reader does not know. The payload
 * of a `message` is exactly one contract frame (section 16.7.5): an item has `data` and no
 * `control`, a control frame has `control` and no `data`, and both or neither is malformed. The
 * suite's id comes from the wire: a non-empty id must equal the `id` member of the item or the
 * `state` of `head` and of a `reset`, and a `gap` and a `reset` without a state carry none (a head
 * of an action that is not resumable has a state and no id).
 */
export function trpcFrameOf(
  event: StreamFrame,
  surface: ApiSurface,
  ref: string,
): StreamFrame | undefined {
  if (event.event === 'serialized-error') {
    const shape = revived(event.data);
    const keelwerk = isRecord(shape) && isRecord(shape.data) ? shape.data.keelwerk : undefined;
    return { event: 'error', id: undefined, data: { error: keelwerk ?? shape } };
  }
  if (event.event !== 'message') return undefined;
  // tRPC clears the id of an untracked frame after a tracked one and restores it with its next `restore-id` event: such a frame carries no id.
  const id = event.id === '' ? undefined : event.id;
  const value = revived(event.data);
  if (!isRecord(value)) return malformed('the payload is no object');
  const hasData = 'data' in value;
  const hasControl = 'control' in value;
  if (hasData === hasControl) return malformed(hasData ? 'both data and control' : 'neither');
  if (hasData) {
    if (id !== undefined && id !== value.id) return malformed('the id is not the item id');
    const action = surface.actions.find((candidate) => candidate.ref === ref);
    return {
      event: 'data',
      id,
      data: action === undefined ? value.data : superjsonWireOf(action.output, value.data),
    };
  }
  const { control, ...rest } = value;
  if (control !== 'head' && control !== 'reset' && control !== 'gap') return undefined;
  const state = typeof rest.state === 'string' && rest.state !== '' ? rest.state : undefined;
  if (control === 'gap' && state !== undefined) return malformed('a gap carries a state');
  if (id !== undefined && id !== state)
    return malformed(`the id is not the state of the ${control}`);
  return { event: control, id, data: rest };
}

/**
 * One subscription over tRPC's server-sent events (distinct connections): `GET /trpc/<path>` with
 * `Accept: text/event-stream`, the input as the `input` query parameter in the superjson envelope,
 * `Last-Event-ID` from `lastEventId` (else `after`) and the stream ticket in the query. The events
 * are read as the suite's frames (head, data, reset, gap, error); tRPC's own `connected`, `ping`
 * and `return` events are skipped, `return` ends the stream. The response carries the status of
 * the first frame's error kind, else 200, with the real headers.
 */
export async function trpcSubscribeOver(
  target: TransportTarget,
  call: SubscribeCall,
  surface: ApiSurface,
): Promise<EventStreamReader> {
  const action = surface.actions.find((candidate) => candidate.ref === call.action);
  if (action === undefined) throw new Error(`The suite has no action '${call.action}'.`);
  const caller = call.caller ?? {};
  const headers = requestHeaders(caller);
  headers.set('accept', 'text/event-stream');
  const resume = call.lastEventId ?? call.after;
  if (resume !== undefined) headers.set('last-event-id', resume);
  const query = new URLSearchParams();
  if (action.input.kind !== 'void' && call.input !== undefined) {
    const value = superjsonValueOf(action.input, call.input);
    query.set('input', JSON.stringify(keelwerkSuperjson().serialize(value as never)));
  }
  if (call.ticket !== undefined) query.set('ticket', call.ticket);
  const search = query.size === 0 ? '' : `?${query}`;
  const response = await target.fetch(
    new Request(
      `${originOf(target, caller)}${caller.pathPrefix ?? ''}/trpc/${trpcPathOf(action).join('.')}${search}`,
      { headers },
    ),
    call.remoteAddress === undefined ? undefined : { remoteAddress: call.remoteAddress },
  );
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return readEventStream(response);
  }
  const events = readEventStream(response);
  let ended = false;
  const next = async (ms?: number): Promise<StreamFrame | undefined> => {
    while (!ended) {
      const event = await events.next(ms);
      if (event === undefined || event.event === 'return') {
        ended = true;
        return undefined;
      }
      const frame = trpcFrameOf(event, surface, call.action);
      if (frame !== undefined) return frame;
    }
    return undefined;
  };
  // The first frame decides the status the answer stands for; it is handed back first.
  const first = await next();
  const failure = first?.event === 'error' && isRecord(first.data) ? first.data.error : undefined;
  const status = isRecord(failure)
    ? statusOfError({ kind: String(failure.kind) as ErrorKind, code: String(failure.code) })
    : 200;
  const queue: (StreamFrame | undefined)[] = [first];
  const read = async (ms?: number): Promise<StreamFrame | undefined> =>
    queue.length > 0 ? queue.shift() : next(ms);
  return {
    response: new Response(null, { status, headers: response.headers }),
    next: read,
    until: async (test, ms) => {
      const seen: StreamFrame[] = [];
      for (;;) {
        const frame = await read(ms);
        if (frame === undefined) return seen;
        seen.push(frame);
        if (test(frame)) return seen;
      }
    },
    close: events.close,
  };
}
